/** Conversation-scoped reads ported from edge executions/repository.server.ts.
 * This capability cannot write and does not widen the trip ReadDatabase. */
import { withChatReadDatabase, type ChatReadDatabase } from "../db/chat-client.server";
import { z } from "zod";
import { boundConversationEvents, computeConversationChatCapability, parseConversationStatus, type SessionEventRecord } from "./projections";
import type { ConversationDetails, ConversationStatusSnapshot } from "./contracts";

export const CONVERSATION_DETAILS_EVENT_LIMIT = 200;
export const CONVERSATION_EVENT_REPLAY_PAGE_SIZE = 200;
export type ConversationScope = {tripId:string;conversationId:string};
const eventSelect = {id:true,conversationId:true,seq:true,type:true,payload:true} as const;
function eventRow(row: Omit<SessionEventRecord,"payload"> & {payload:unknown}): SessionEventRecord {
  return {...row,payload:z.record(z.string(),z.unknown()).parse(row.payload)};
}
export function createChatRepository(db: ChatReadDatabase) {
  const scoped = (scope:ConversationScope) => ({id:scope.conversationId,tripId:scope.tripId});
  return {
    async loadConversationDetails(scope:ConversationScope, options:{retentionDays:number;now?:Date;waitingOnApproval?:boolean}):Promise<ConversationDetails|null> {
      const conversation = await db.conversation.findFirst({where:scoped(scope),select:{
        id:true,tripId:true,status:true,runtimeStatus:true,createdAt:true,finishedAt:true,error:true,agentSessionId:true,activeRequestId:true,activeTurnId:true,
        messages:{orderBy:{seq:"desc"},select:eventSelect,take:CONVERSATION_DETAILS_EVENT_LIMIT+1},
      }});
      if (!conversation) return null;
      const events = conversation.messages.map(eventRow);
      return {id:conversation.id,tripId:conversation.tripId,status:parseConversationStatus(conversation.status),createdAt:conversation.createdAt.toISOString(),finishedAt:conversation.finishedAt?.toISOString() ?? null,error:conversation.error,
        ...boundConversationEvents(events,CONVERSATION_DETAILS_EVENT_LIMIT),lastEventSeq:events[0]?.seq ?? -1,agentSessionId:conversation.agentSessionId,pendingWakeupAt:null,chat:computeConversationChatCapability(conversation,options)};
    },
    async loadConversationEventsAfter(scope:ConversationScope,afterSeq:number) {
      if (!Number.isSafeInteger(afterSeq) || afterSeq < -1) throw new Error("Invalid replay cursor.");
      const rows = await db.message.findMany({where:{conversationId:scope.conversationId,conversation:{tripId:scope.tripId},seq:{gt:afterSeq}},orderBy:{seq:"asc"},select:eventSelect,take:CONVERSATION_EVENT_REPLAY_PAGE_SIZE+1});
      const events = rows.slice(0,CONVERSATION_EVENT_REPLAY_PAGE_SIZE).map(eventRow);
      return {events,hasMore:rows.length>CONVERSATION_EVENT_REPLAY_PAGE_SIZE,nextAfterSeq:events.at(-1)?.seq ?? afterSeq};
    },
    loadConversationSessionState:(scope:ConversationScope) => db.conversation.findFirst({where:scoped(scope),select:{runtimeStatus:true,status:true,activeRequestId:true,activeTurnId:true}}),
    async loadConversationStatus(scope:ConversationScope) {
      const row = await db.conversation.findFirst({where:scoped(scope),select:{status:true}});
      return row ? parseConversationStatus(row.status) : null;
    },
    async loadConversationStatusSnapshot(scope:ConversationScope):Promise<ConversationStatusSnapshot|null> {
      const row = await db.conversation.findFirst({where:scoped(scope),select:{status:true,error:true,finishedAt:true,messages:{orderBy:{seq:"desc"},select:{seq:true},take:1}}});
      return row ? {status:parseConversationStatus(row.status),error:row.error,finishedAt:row.finishedAt?.toISOString() ?? null,lastEventSeq:row.messages[0]?.seq ?? -1} : null;
    },
    loadConversationChatState:(scope:ConversationScope) => db.conversation.findFirst({where:scoped(scope),select:{id:true,tripId:true,agentSessionId:true,status:true,runtimeStatus:true,streamIndex:true,activeRequestId:true,activeTurnId:true,finishedAt:true}}),
    async findUserMessageByRequestId(scope:ConversationScope,requestId:string) {
      const row = await db.message.findFirst({where:{conversationId:scope.conversationId,conversation:{tripId:scope.tripId},type:"user_message",requestId},select:eventSelect});
      return row ? {...eventRow(row),duplicate:true} : null;
    },
    async loadQueuedMessages(scope:ConversationScope) {
      const rows = await db.message.findMany({where:{conversationId:scope.conversationId,conversation:{tripId:scope.tripId},type:"user_message",payload:{path:["delivery"],equals:"queued"}},orderBy:{seq:"asc"},select:eventSelect});
      return rows.map(eventRow);
    },
    async loadOldestQueuedMessage(scope:ConversationScope) {
      const row = await db.message.findFirst({where:{conversationId:scope.conversationId,conversation:{tripId:scope.tripId},type:"user_message",payload:{path:["delivery"],equals:"queued"}},orderBy:{seq:"asc"},select:eventSelect});
      if (!row) return null;
      const event = eventRow(row);
      return {id:row.id,seq:row.seq,text:typeof event.payload.text === "string" ? event.payload.text : "",requestId:typeof event.payload.requestId === "string" ? event.payload.requestId : ""};
    },
    // Runtime work/claim is authoritative; business turn status no longer hides a
    // follow-up after a previously completed turn (edge Q7 restart seam).
    loadResumableConversations:(tripId:string) => db.conversation.findMany({where:{tripId,agentSessionId:{not:null},runtimeStatus:{not:"closed"},OR:[{runtimeStatus:{in:["active","starting","stopping"]}},{activeRequestId:{not:null}},{messages:{some:{type:"user_message",OR:[{payload:{path:["delivery"],equals:"pending"}},{payload:{path:["delivery"],equals:"queued"}}]}}}]},select:{id:true,agentSessionId:true,streamIndex:true},orderBy:{createdAt:"asc"}}),
    loadPendingExtraction:(scope:ConversationScope,id:string) => db.pendingExtraction.findFirst({where:{id,conversationId:scope.conversationId,conversation:{tripId:scope.tripId}}}),
    loadUpload:(scope:ConversationScope,id:string) => db.upload.findFirst({where:{id,conversationId:scope.conversationId,conversation:{tripId:scope.tripId}}}),
  };
}
export const loadConversationDetails = (scope:ConversationScope,options:Parameters<ReturnType<typeof createChatRepository>["loadConversationDetails"]>[1]) => withChatReadDatabase(db=>createChatRepository(db).loadConversationDetails(scope,options));
export const loadConversationEventsAfter = (scope:ConversationScope,afterSeq:number) => withChatReadDatabase(db=>createChatRepository(db).loadConversationEventsAfter(scope,afterSeq));
export const loadConversationSessionState = (scope:ConversationScope) => withChatReadDatabase(db=>createChatRepository(db).loadConversationSessionState(scope));
export const loadConversationStatus = (scope:ConversationScope) => withChatReadDatabase(db=>createChatRepository(db).loadConversationStatus(scope));
export const loadConversationStatusSnapshot = (scope:ConversationScope) => withChatReadDatabase(db=>createChatRepository(db).loadConversationStatusSnapshot(scope));
export const loadConversationChatState = (scope:ConversationScope) => withChatReadDatabase(db=>createChatRepository(db).loadConversationChatState(scope));
export const findUserMessageByRequestId = (scope:ConversationScope,key:string) => withChatReadDatabase(db=>createChatRepository(db).findUserMessageByRequestId(scope,key));
export const loadQueuedMessages = (scope:ConversationScope) => withChatReadDatabase(db=>createChatRepository(db).loadQueuedMessages(scope));
export const loadOldestQueuedMessage = (scope:ConversationScope) => withChatReadDatabase(db=>createChatRepository(db).loadOldestQueuedMessage(scope));
export const hasQueuedMessages = async (scope:ConversationScope) => (await loadOldestQueuedMessage(scope)) !== null;
export const loadResumableConversations = (tripId:string) => withChatReadDatabase(db=>createChatRepository(db).loadResumableConversations(tripId));
export const loadPendingExtraction = (scope:ConversationScope,id:string) => withChatReadDatabase(db=>createChatRepository(db).loadPendingExtraction(scope,id));
export const loadUpload = (scope:ConversationScope,id:string) => withChatReadDatabase(db=>createChatRepository(db).loadUpload(scope,id));
