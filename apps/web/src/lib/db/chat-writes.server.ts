/** Port of edge runtime/session-events.ts and delivery writers. All returned rows
 * are committed before callers relay them. No provider work or trip writes here. */
import { createId } from "@paralleldrive/cuid2";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type Message } from "../../../prisma/generated/client";
import { withChatDatabase, type ChatDatabase, type ChatTransaction } from "./chat-client.server";
import { parseAnswerSources } from "../chat/sources";
import type { SessionEventRecord } from "../chat/projections";

export type InsertConversationEventResult = SessionEventRecord & { duplicate: boolean };
export type ConversationEventInsert = {
  conversationId: string; type: string; payload: Record<string, unknown>;
  providerEventKey?: string; requestId?: string; uploadId?: string;
};
export type RuntimeSessionStatus = "starting" | "active" | "stopping" | "stop_failed" | "waiting" | "closed";
const payloadSchema = z.record(z.string(), z.json());
const textSchema = z.string().min(1).max(8192).refine(v => v.trim().length > 0);
const keySchema = z.string().trim().min(1).max(256);
function json(value: unknown): Prisma.InputJsonValue { return z.json().parse(value) as Prisma.InputJsonValue; }
function payload(value: unknown): Record<string, unknown> { return payloadSchema.parse(value); }
export function messageColumns(type: string, value: Record<string, unknown>) {
  const role = type === "user_message" ? "user" : type === "message" ? "assistant" : type === "tool_call" || type === "tool_result" ? "tool" : "system";
  const text = typeof value.text === "string" ? value.text : "";
  const sourceSections = role === "assistant" ? parseAnswerSources(text).sources.map(source => source.id) : [];
  return {role, content: text, sourceSections};
}
function rowRecord(row: Pick<Message, "id" | "conversationId" | "seq" | "type" | "payload">): SessionEventRecord {
  return {id:row.id, conversationId:row.conversationId, seq:row.seq, type:row.type, payload:payload(row.payload)};
}
function duplicateError(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
async function lockConversation(tx: ChatTransaction, conversationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`;
  const conversation = await tx.conversation.findFirst({where:{id:conversationId}});
  if (!conversation) throw new Error("Conversation not found.");
  return conversation;
}
function eventIdentity(event: ConversationEventInsert & {seq?:number}) {
  return event.providerEventKey ? {providerEventKey:event.providerEventKey} : event.requestId ? {requestId:event.requestId} : event.seq !== undefined ? {seq:event.seq} : null;
}
async function ownedUpload(tx: ChatTransaction, conversationId: string, uploadId?: string) {
  if (!uploadId) return null;
  const upload = await tx.upload.findFirst({where:{id:uploadId,conversationId}});
  if (!upload || upload.status !== "mounted" || !upload.fileId || !upload.mountedFileId || !upload.sessionResourceId || !upload.mountPath || upload.deletedFromAnthropicAt) throw new Error("Attachment is not available in this conversation.");
  return upload;
}
async function insertInTransaction(tx: ChatTransaction, event: ConversationEventInsert & {seq?:number}): Promise<InsertConversationEventResult> {
  const identity = eventIdentity(event);
  if (identity) {
    const existing = await tx.message.findFirst({where:{conversationId:event.conversationId,...identity}});
    if (existing) return {...rowRecord(existing),duplicate:true};
  }
  if (event.type === "user_message") {
    // Linearize a new guest correction against the confirmed flight commit.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`flight-confirmation:${event.conversationId}`}, 0))::text`;
  }
  const upload = await ownedUpload(tx,event.conversationId,event.uploadId);
  let seq: number;
  if (event.seq === undefined) {
    const conversation = await tx.conversation.update({where:{id:event.conversationId},data:{nextEventSeq:{increment:1}},select:{nextEventSeq:true}});
    seq = conversation.nextEventSeq - 1;
  } else {
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw new Error("Invalid event sequence.");
    const conversation = await lockConversation(tx,event.conversationId);
    seq = event.seq;
    if (conversation.nextEventSeq <= seq) await tx.conversation.update({where:{id:event.conversationId},data:{nextEventSeq:seq+1}});
  }
  const columns = messageColumns(event.type,event.payload);
  const eventPayload = {...payload(event.payload), sourceSections:columns.sourceSections,
    ...(upload ? {upload:{id:upload.id,filename:upload.originalFilename,mimeType:upload.mimeType,sizeBytes:upload.sizeBytes}} : {})};
  const row = await tx.message.create({data:{id:createId(),conversationId:event.conversationId,seq,type:event.type,
    payload:json(eventPayload),...columns,providerEventKey:event.providerEventKey ?? null,requestId:event.requestId ?? null,uploadId:event.uploadId ?? null}});
  return {...rowRecord(row),duplicate:false};
}
const clearConsent = {readbackVersion:null,readbackMessageId:null,confirmationMessageId:null,confirmedAt:null,guestCreationConsentMessageId:null};

/** Injected Prisma capability: unit tests use transaction fakes, production owns a
 * per-call client. Queue rows keep their id/seq when delivery changes (Q7). */
export function createChatWrites(db: ChatDatabase, now: () => Date = () => new Date()) {
  async function insert(event: ConversationEventInsert & {seq?:number}) {
    keySchema.parse(event.conversationId); keySchema.parse(event.type); payload(event.payload);
    if (event.requestId) keySchema.parse(event.requestId);
    if (event.providerEventKey) keySchema.parse(event.providerEventKey);
    const identity = eventIdentity(event);
    try { return await db.$transaction(tx => insertInTransaction(tx,event)); }
    catch (error) {
      // PostgreSQL has aborted the losing transaction. Recover ONLY outside it.
      if (!duplicateError(error) || !identity) throw error;
      const existing = await db.message.findFirst({where:{conversationId:event.conversationId,...identity}});
      if (!existing) throw error;
      return {...rowRecord(existing),duplicate:true};
    }
  }
  async function updateDelivery(tx: ChatTransaction, input: {conversationId:string; requestId?:string; rowId?:string; delivery:"queued"|"sent"|"failed"; error?:string; queuedOnly?:boolean}) {
    const row = await tx.message.findFirst({where:{conversationId:input.conversationId,type:"user_message",...(input.rowId ? {id:input.rowId} : {requestId:input.requestId})}});
    if (!row) return null;
    const previous = payload(row.payload);
    if (input.queuedOnly && previous.delivery !== "queued") return null;
    // A delayed queued acknowledgement must never regress a settled row.
    if ((previous.delivery === "sent" || previous.delivery === "failed") && input.delivery !== previous.delivery) return rowRecord(row);
    const {deliveryError: _oldError, ...rest} = previous;
    const next = {...rest,delivery:input.delivery,...(input.error ? {deliveryError:input.error} : {})};
    const updated = await tx.message.update({where:{id:row.id},data:{payload:json(next),...messageColumns(row.type,next)}});
    return rowRecord(updated);
  }
  async function settleQueue(input: {conversationId:string; beforeSeq?:number; error:string}) {
    return db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const rows = await tx.message.findMany({where:{conversationId:input.conversationId,type:"user_message",...(input.beforeSeq !== undefined ? {seq:{lt:input.beforeSeq}} : {})},orderBy:{seq:"asc"}});
      const changed: SessionEventRecord[] = [];
      for (const row of rows) if (payload(row.payload).delivery === "queued") {
        const next = await updateDelivery(tx,{conversationId:input.conversationId,rowId:row.id,delivery:"failed",error:input.error,queuedOnly:true});
        if (next) changed.push(next);
      }
      return changed;
    });
  }
  async function pending(tx: ChatTransaction, input: {conversationId:string;pendingExtractionId:string;version:number}) {
    await lockConversation(tx,input.conversationId);
    await tx.$queryRaw`SELECT "id" FROM "PendingExtraction" WHERE "id" = ${input.pendingExtractionId} AND "conversationId" = ${input.conversationId} FOR UPDATE`;
    const row = await tx.pendingExtraction.findFirst({where:{id:input.pendingExtractionId,conversationId:input.conversationId}});
    if (!row || row.version !== input.version || row.expiresAt <= now() || row.consumedAt || row.phase === "expired") throw new Error("Extraction is expired, changed, or already consumed.");
    return row;
  }
  async function message(tx: ChatTransaction, conversationId:string,id:string,role:"user"|"assistant") {
    const row = await tx.message.findFirst({where:{id,conversationId,role}});
    if (!row || !row.content.trim()) throw new Error("A persisted conversation message is required.");
    return row;
  }
  async function applyBoundary(input:{conversationId:string;eventId:string;status:"completed"|"failed"|"stopped";error?:string},terminal:boolean) {
    return db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const event = await tx.message.findFirst({where:{id:input.eventId,conversationId:input.conversationId}});
      if (!event) throw new Error("Persist the boundary before applying it.");
      if (event.lifecycleAppliedAt) return null;
      if (!event.type.startsWith(terminal ? "session." : "turn.") || !["completed","failed","cancelled"].some(suffix=>event.type.endsWith(suffix))) throw new Error("Invalid lifecycle boundary.");
      const continuation = payload(event.payload).continuation === true && (event.type === "turn.completed" || event.type === "turn.cancelled");
      if (!continuation) {
        await tx.conversation.update({where:{id:input.conversationId},data:{status:input.status,runtimeStatus:terminal ? "closed" : "waiting",activeRequestId:null,activeTurnId:null,finishedAt:now(),error:input.error ?? null}});
        if (terminal) {
          const queued = await tx.message.findMany({where:{conversationId:input.conversationId,type:"user_message"},orderBy:{seq:"asc"}});
          for (const row of queued) if (payload(row.payload).delivery === "queued") await updateDelivery(tx,{conversationId:input.conversationId,rowId:row.id,delivery:"failed",error:"The conversation ended before the agent read this.",queuedOnly:true});
        }
      }
      // Atomic with state: a duplicate insert after a crash may safely retry this.
      await tx.message.update({where:{id:event.id},data:{lifecycleAppliedAt:now()}});
      return rowRecord(event);
    });
  }
  return {
    insertConversationEvent: (event:ConversationEventInsert & {seq:number}) => insert(event),
    insertConversationEventAllocating: (event:ConversationEventInsert) => insert(event),
    appendUserMessage: (input:{conversationId:string;text:string;requestId:string;uploadId?:string}) => insert({conversationId:input.conversationId,type:"user_message",payload:{text:textSchema.parse(input.text),delivery:"pending",requestId:keySchema.parse(input.requestId)},requestId:input.requestId,uploadId:input.uploadId}),
    async createDraftConversation(input:{tripId:string;requestId?:string}) {
      if (input.requestId) {
        const existing = await db.conversation.findFirst({where:{tripId:input.tripId,requestId:input.requestId}});
        if (existing) return existing;
      }
      try { return await db.$transaction(tx => tx.conversation.create({data:{id:createId(),tripId:input.tripId,requestId:input.requestId,status:"completed",runtimeStatus:"waiting"}})); }
      catch(error) {
        if (!duplicateError(error) || !input.requestId) throw error;
        const existing = await db.conversation.findFirst({where:{tripId:input.tripId,requestId:input.requestId}});
        if (!existing) throw error;
        return existing;
      }
    },
    async createConversationWithOpeningMessage(input:{tripId:string;text:string;requestId:string}) {
      textSchema.parse(input.text); keySchema.parse(input.requestId);
      const recover = async () => {
        const conversation = await db.conversation.findFirst({where:{tripId:input.tripId,requestId:input.requestId}});
        if (!conversation) return null;
        const row = await db.message.findFirst({where:{conversationId:conversation.id,requestId:input.requestId}});
        if (!row) throw new Error("Opening request already reserved for a draft conversation.");
        return {conversation,message:{...rowRecord(row),duplicate:true}};
      };
      const existing = await recover(); if (existing) return existing;
      try { return await db.$transaction(async tx => {
        const conversation = await tx.conversation.create({data:{id:createId(),tripId:input.tripId,requestId:input.requestId,runtimeStatus:"starting",status:"running",activeRequestId:input.requestId}});
        const message = await insertInTransaction(tx,{conversationId:conversation.id,type:"user_message",requestId:input.requestId,payload:{text:input.text,requestId:input.requestId,delivery:"pending"}});
        return {conversation,message};
      }); } catch(error) { if (!duplicateError(error)) throw error; const result = await recover(); if (!result) throw error; return result; }
    },
    attachAgentSession: (input:{conversationId:string;sessionId:string}) => db.$transaction(async tx => {
      const conversation = await lockConversation(tx,input.conversationId);
      if (conversation.agentSessionId && conversation.agentSessionId !== input.sessionId) throw new Error("Conversation already has a provider session.");
      return tx.conversation.update({where:{id:input.conversationId},data:{agentSessionId:keySchema.parse(input.sessionId)}});
    }),
    updateConversationCursor: (input:{conversationId:string;streamIndex:number}) => db.$transaction(async tx => {
      const conversation = await lockConversation(tx,input.conversationId);
      z.number().int().nonnegative().parse(input.streamIndex);
      return tx.conversation.update({where:{id:input.conversationId},data:{streamIndex:Math.max(conversation.streamIndex,input.streamIndex)}});
    }),
    updateConversationSessionState: (input:{conversationId:string;runtimeStatus?:RuntimeSessionStatus;activeRequestId?:string;activeTurnId?:string|null;releaseActiveRequest?:boolean}) => db.$transaction(async tx => {
      const conversation = await lockConversation(tx,input.conversationId);
      if (conversation.runtimeStatus === "closed" && input.runtimeStatus !== "closed") throw new Error("Conversation session is closed.");
      const active = input.activeRequestId !== undefined || input.runtimeStatus === "active" || input.runtimeStatus === "starting";
      return tx.conversation.update({where:{id:input.conversationId},data:{
        ...(input.runtimeStatus ? {runtimeStatus:input.runtimeStatus} : {}),...(active ? {status:"running",finishedAt:null,error:null} : {}),
        ...(input.activeTurnId !== undefined ? {activeTurnId:input.activeTurnId} : {}),...(input.activeRequestId ? {activeRequestId:input.activeRequestId} : {}),...(input.releaseActiveRequest ? {activeRequestId:null} : {}),
      }});
    }),
    markUserMessageDelivery: (input:{conversationId:string;requestId:string;delivery:"queued"|"sent"|"failed";error?:string}) => db.$transaction(async tx => {await lockConversation(tx,input.conversationId); return updateDelivery(tx,input);}),
    markQueuedMessageDelivered: (input:{conversationId:string;rowId:string}) => db.$transaction(async tx => {await lockConversation(tx,input.conversationId); return updateDelivery(tx,{...input,delivery:"sent",queuedOnly:true});}),
    failQueuedMessages: (input:{conversationId:string;error:string}) => settleQueue(input),
    supersedeQueuedMessagesBeforeSeq: (input:{conversationId:string;beforeSeq:number;error:string}) => settleQueue(input),
    parkConversationTurn: (input:Parameters<typeof applyBoundary>[0]) => applyBoundary(input,false),
    closeConversation: (input:Parameters<typeof applyBoundary>[0]) => applyBoundary(input,true),
    async createUploadRecord(input:{conversationId:string;bytes:Uint8Array;originalFilename:string;mimeType:string;sizeBytes:number;purpose:"FLIGHT_CONFIRMATION"|"OTHER"}) {
      // Hash original bytes, never a filename or a caller-supplied digest.
      const sha256 = createHash("sha256").update(input.bytes).digest("hex");
      const recover = async () => {
        const existing = await db.upload.findFirst({where:{sha256}});
        if (!existing) return null;
        if (existing.conversationId !== input.conversationId) throw new Error("This file cannot be attached here. Retry in the original conversation or upload a new screenshot.");
        return existing;
      };
      const existing = await recover(); if (existing) return existing;
      try { return await db.$transaction(async tx => {
        await lockConversation(tx,input.conversationId);
        return tx.upload.create({data:{id:createId(),conversationId:input.conversationId,sha256,status:"pending",fileId:null,
          originalFilename:z.string().min(1).parse(input.originalFilename),mimeType:z.string().min(1).parse(input.mimeType),sizeBytes:z.number().int().positive().parse(input.sizeBytes),purpose:input.purpose}});
      }); } catch(error) { if (!duplicateError(error)) throw error; const result = await recover(); if (!result) throw error; return result; }
    },
    attachUploadResource: (input:{conversationId:string;uploadId:string;fileId:string;mountedFileId?:string;sessionResourceId?:string;mountPath?:string}) => db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const upload = await tx.upload.findFirst({where:{id:input.uploadId,conversationId:input.conversationId}});
      if (!upload || upload.deletedFromAnthropicAt || upload.originalFileDeletedAt || upload.mountedFileDeletedAt || upload.sessionResourceDeletedAt) throw new Error("Upload is unavailable.");
      for (const key of ["fileId","mountedFileId","sessionResourceId","mountPath"] as const) {
        if (input[key] !== undefined) keySchema.parse(input[key]);
        if (upload[key] && input[key] && upload[key] !== input[key]) throw new Error("Upload resource identity cannot change.");
      }
      const mounted = input.mountedFileId ?? upload.mountedFileId;
      const resource = input.sessionResourceId ?? upload.sessionResourceId;
      const path = input.mountPath ?? upload.mountPath;
      return tx.upload.update({where:{id:upload.id},data:{fileId:input.fileId,...(mounted ? {mountedFileId:mounted} : {}),...(resource ? {sessionResourceId:resource} : {}),...(path ? {mountPath:path} : {}),status:mounted && resource && path ? "mounted" : "uploaded"}});
    }),
    markUploadProcessed: (input:{conversationId:string;uploadId:string;extractionResult:unknown}) => db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const upload = await tx.upload.findFirst({where:{id:input.uploadId,conversationId:input.conversationId}});
      if (!upload) throw new Error("Upload not found.");
      return tx.upload.update({where:{id:upload.id},data:{processedAt:now(),extractionResult:json(input.extractionResult)}});
    }),
    markUploadCopyDeleted: (input:{conversationId:string;uploadId:string;copy:"original"|"mounted"|"resource";providerId:string}) => db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const upload = await tx.upload.findFirst({where:{id:input.uploadId,conversationId:input.conversationId}});
      if (!upload) throw new Error("Upload not found.");
      const idKey = input.copy === "original" ? "fileId" : input.copy === "mounted" ? "mountedFileId" : "sessionResourceId";
      const dateKey = input.copy === "original" ? "originalFileDeletedAt" : input.copy === "mounted" ? "mountedFileDeletedAt" : "sessionResourceDeletedAt";
      if (!upload[idKey] || upload[idKey] !== input.providerId) throw new Error("Deletion identity does not match the stored copy.");
      const next = {...upload,[dateKey]:upload[dateKey] ?? now()};
      const deleted = (!next.fileId || next.originalFileDeletedAt) && (!next.mountedFileId || next.mountedFileDeletedAt) && (!next.sessionResourceId || next.sessionResourceDeletedAt);
      return tx.upload.update({where:{id:upload.id},data:{[dateKey]:next[dateKey],...(deleted ? {deletedFromAnthropicAt:upload.deletedFromAnthropicAt ?? now(),status:"deleted"} : {})}});
    }),
    promoteFlightConfirmationUpload: (input:{conversationId:string;uploadId:string}) => db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const upload = await tx.upload.findFirst({where:{id:input.uploadId,conversationId:input.conversationId}});
      if (!upload) throw new Error("Upload not found in this conversation.");
      if (upload.purpose === "FLIGHT_CONFIRMATION") return upload;
      if (upload.purpose !== "OTHER") throw new Error("Upload purpose cannot be promoted.");
      return tx.upload.update({where:{id:upload.id},data:{purpose:"FLIGHT_CONFIRMATION"}});
    }),
    savePendingExtraction: (input:{conversationId:string;pendingExtractionId?:string;version?:number;uploadId:string;flightCandidates:unknown;outstandingQuestion?:string;expiresAt:Date}) => db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      const upload = await tx.upload.findFirst({where:{id:input.uploadId,conversationId:input.conversationId}});
      if (!upload || upload.purpose !== "FLIGHT_CONFIRMATION") throw new Error("A flight-confirmation upload in this conversation is required.");
      if (input.expiresAt <= now()) throw new Error("Extraction expiry must be in the future.");
      const candidates = flightExtractionSchema.parse(input.flightCandidates);
      if (!input.pendingExtractionId) return tx.pendingExtraction.create({data:{id:createId(),conversationId:input.conversationId,uploadId:input.uploadId,flightCandidates:json(candidates),expiresAt:input.expiresAt,outstandingQuestion:input.outstandingQuestion}});
      if (input.version === undefined) throw new Error("Expected extraction version is required.");
      const previous = await pending(tx,{conversationId:input.conversationId,pendingExtractionId:input.pendingExtractionId,version:input.version});
      if (previous.uploadId !== input.uploadId) throw new Error("Extraction upload cannot change.");
      // A correction always advances the version and invalidates prior consent.
      return tx.pendingExtraction.update({where:{id:previous.id},data:{flightCandidates:json(candidates),version:{increment:1},phase:"collecting",...clearConsent,outstandingQuestion:input.outstandingQuestion ?? null}});
    }),
    recordClaimedGuestName: (input:{conversationId:string;pendingExtractionId:string;version:number;firstName:string;lastName:string;messageId:string;guestId?:string;guestCreationConsentMessageId?:string}) => db.$transaction(async tx => {
      const extraction = await pending(tx,input);
      await message(tx,input.conversationId,input.messageId,"user");
      const firstName = z.string().trim().min(1).parse(input.firstName);
      const lastName = z.string().trim().parse(input.lastName); // Existing mononym remains valid.
      if (input.guestCreationConsentMessageId) {
        const consent = await message(tx,input.conversationId,input.guestCreationConsentMessageId,"user");
        if (!isExplicitGuestCreationConsent(consent.content)) throw new Error("Explicit consent to add a guest is required.");
      }
      return tx.pendingExtraction.update({where:{id:extraction.id},data:{claimedFirstName:firstName,claimedLastName:lastName,nameMessageId:input.messageId,guestId:input.guestId ?? null,version:{increment:1},phase:"named",...clearConsent,guestCreationConsentMessageId:input.guestCreationConsentMessageId ?? null}});
    }),
    recordIntakeReadback: (input:{conversationId:string;pendingExtractionId:string;version:number;messageId:string}) => db.$transaction(async tx => {
      const extraction = await pending(tx,input);
      if (!extraction.claimedFirstName || extraction.claimedLastName === null || !extraction.nameMessageId) throw new Error("Persist a claimed name before the read-back.");
      const name = await message(tx,input.conversationId,extraction.nameMessageId,"user");
      const readback = await message(tx,input.conversationId,input.messageId,"assistant");
      if (readback.seq <= name.seq) throw new Error("Read-back must follow the name claim.");
      const reference = payload(readback.payload).intakeReadback;
      const expected = z.object({pendingExtractionId:z.literal(extraction.id),version:z.literal(extraction.version)}).safeParse(reference);
      if (!expected.success) throw new Error("Read-back message does not describe this exact extraction version.");
      return tx.pendingExtraction.update({where:{id:extraction.id},data:{readbackVersion:extraction.version,readbackMessageId:readback.id,confirmationMessageId:null,confirmedAt:null,phase:"awaiting_confirmation",outstandingQuestion:null}});
    }),
    confirmPendingExtraction: (input:{conversationId:string;pendingExtractionId:string;version:number;messageId:string}) => db.$transaction(async tx => {
      const extraction = await pending(tx,input);
      if (!extraction.nameMessageId || !extraction.claimedFirstName || extraction.claimedLastName === null || !extraction.readbackMessageId || extraction.readbackVersion !== input.version) throw new Error("The current name and exact read-back version must be persisted.");
      const readback = await message(tx,input.conversationId,extraction.readbackMessageId,"assistant");
      const affirmative = await message(tx,input.conversationId,input.messageId,"user");
      if (affirmative.seq <= readback.seq || !isAffirmativeFlightConfirmation(affirmative.content)) throw new Error("An affirmative guest reply after this read-back is required.");
      const intervening = await tx.message.findFirst({where:{conversationId:input.conversationId,role:"user",seq:{gt:readback.seq,lt:affirmative.seq}}});
      if (intervening) throw new Error("Read back the current details again after the guest correction.");
      return tx.pendingExtraction.update({where:{id:extraction.id},data:{confirmationMessageId:affirmative.id,confirmedAt:now(),phase:"confirmed",outstandingQuestion:null}});
    }),
    expirePendingExtraction: (input:{conversationId:string;pendingExtractionId:string}) => db.$transaction(async tx => {
      await lockConversation(tx,input.conversationId);
      await tx.$queryRaw`SELECT "id" FROM "PendingExtraction" WHERE "id" = ${input.pendingExtractionId} AND "conversationId" = ${input.conversationId} FOR UPDATE`;
      const extraction = await tx.pendingExtraction.findFirst({where:{id:input.pendingExtractionId,conversationId:input.conversationId}});
      if (!extraction || extraction.consumedAt || extraction.expiresAt > now()) return null;
      return tx.pendingExtraction.update({where:{id:extraction.id},data:{phase:"expired",...clearConsent}});
    }),
  };
}

import { flightExtractionSchema, isAffirmativeFlightConfirmation, isExplicitGuestCreationConsent } from "./flight-contract";
type Writes = ReturnType<typeof createChatWrites>;
export const createDraftConversation = (input:Parameters<Writes["createDraftConversation"]>[0]) => withChatDatabase(db => createChatWrites(db).createDraftConversation(input));
export const createConversationWithOpeningMessage = (input:Parameters<Writes["createConversationWithOpeningMessage"]>[0]) => withChatDatabase(db => createChatWrites(db).createConversationWithOpeningMessage(input));
export const attachAgentSession = (input:Parameters<Writes["attachAgentSession"]>[0]) => withChatDatabase(db => createChatWrites(db).attachAgentSession(input));
export const updateConversationCursor = (input:Parameters<Writes["updateConversationCursor"]>[0]) => withChatDatabase(db => createChatWrites(db).updateConversationCursor(input));
export const insertConversationEvent = (input:Parameters<Writes["insertConversationEvent"]>[0]) => withChatDatabase(db => createChatWrites(db).insertConversationEvent(input));
export const insertConversationEventAllocating = (input:Parameters<Writes["insertConversationEventAllocating"]>[0]) => withChatDatabase(db => createChatWrites(db).insertConversationEventAllocating(input));
export const appendUserMessage = (input:Parameters<Writes["appendUserMessage"]>[0]) => withChatDatabase(db => createChatWrites(db).appendUserMessage(input));
export const markUserMessageDelivery = (input:Parameters<Writes["markUserMessageDelivery"]>[0]) => withChatDatabase(db => createChatWrites(db).markUserMessageDelivery(input));
export const markQueuedMessageDelivered = (input:Parameters<Writes["markQueuedMessageDelivered"]>[0]) => withChatDatabase(db => createChatWrites(db).markQueuedMessageDelivered(input));
export const failQueuedMessages = (input:Parameters<Writes["failQueuedMessages"]>[0]) => withChatDatabase(db => createChatWrites(db).failQueuedMessages(input));
export const supersedeQueuedMessagesBeforeSeq = (input:Parameters<Writes["supersedeQueuedMessagesBeforeSeq"]>[0]) => withChatDatabase(db => createChatWrites(db).supersedeQueuedMessagesBeforeSeq(input));
export const updateConversationSessionState = (input:Parameters<Writes["updateConversationSessionState"]>[0]) => withChatDatabase(db => createChatWrites(db).updateConversationSessionState(input));
export const parkConversationTurn = (input:Parameters<Writes["parkConversationTurn"]>[0]) => withChatDatabase(db => createChatWrites(db).parkConversationTurn(input));
export const closeConversation = (input:Parameters<Writes["closeConversation"]>[0]) => withChatDatabase(db => createChatWrites(db).closeConversation(input));
export const createUploadRecord = (input:Parameters<Writes["createUploadRecord"]>[0]) => withChatDatabase(db => createChatWrites(db).createUploadRecord(input));
export const attachUploadResource = (input:Parameters<Writes["attachUploadResource"]>[0]) => withChatDatabase(db => createChatWrites(db).attachUploadResource(input));
export const markUploadProcessed = (input:Parameters<Writes["markUploadProcessed"]>[0]) => withChatDatabase(db => createChatWrites(db).markUploadProcessed(input));
export const markUploadCopyDeleted = (input:Parameters<Writes["markUploadCopyDeleted"]>[0]) => withChatDatabase(db => createChatWrites(db).markUploadCopyDeleted(input));
export const savePendingExtraction = (input:Parameters<Writes["savePendingExtraction"]>[0]) => withChatDatabase(db => createChatWrites(db).savePendingExtraction(input));
export const promoteFlightConfirmationUpload = (input:Parameters<Writes["promoteFlightConfirmationUpload"]>[0]) => withChatDatabase(db => createChatWrites(db).promoteFlightConfirmationUpload(input));
export const recordClaimedGuestName = (input:Parameters<Writes["recordClaimedGuestName"]>[0]) => withChatDatabase(db => createChatWrites(db).recordClaimedGuestName(input));
export const recordIntakeReadback = (input:Parameters<Writes["recordIntakeReadback"]>[0]) => withChatDatabase(db => createChatWrites(db).recordIntakeReadback(input));
export const confirmPendingExtraction = (input:Parameters<Writes["confirmPendingExtraction"]>[0]) => withChatDatabase(db => createChatWrites(db).confirmPendingExtraction(input));
export const expirePendingExtraction = (input:Parameters<Writes["expirePendingExtraction"]>[0]) => withChatDatabase(db => createChatWrites(db).expirePendingExtraction(input));
