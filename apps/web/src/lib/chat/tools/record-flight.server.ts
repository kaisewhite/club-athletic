import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { z } from "zod";
import {
  createFlightIntake,
  flightIntakeDependencies,
  type IntakeDependencies,
} from "../flight-intake.server";
import type { ConversationScope } from "../repository.server";
import { recordFlightSchema, recordFlightDescription } from "./flight-schema";
import { TRIP_UNAVAILABLE } from "./read-tools.server";

export function createRecordFlightTool(
  scope: ConversationScope,
  deps: IntakeDependencies = flightIntakeDependencies(),
): BetaRunnableTool<unknown> {
  const intake = createFlightIntake(deps);
  // The SDK may dispatch calls concurrently. Serialize this conversation's intake
  // transitions; database locks/version checks remain authoritative across owners.
  let tail = Promise.resolve();
  return {
    name: "recordFlight",
    description: recordFlightDescription,
    input_schema: { ...z.toJSONSchema(recordFlightSchema), type: "object" },
    parse: (input) => {
      const result = recordFlightSchema.safeParse(input);
      if (!result.success)
        throw new Error("Invalid flight extraction contract.");
      return result.data;
    },
    run: (input, context) => {
      const run = tail.then(async () => {
        if (!context?.toolUse.id || !context.signal)
          return JSON.stringify({
            committed: false,
            phase: "unavailable",
            followUp: TRIP_UNAVAILABLE,
          });
        context.signal.throwIfAborted();
        return JSON.stringify(
          await intake.run(input, {
            scope,
            toolCallId: context.toolUse.id,
            signal: context.signal,
          }),
        );
      });
      tail = run.then(
        () => {},
        () => {},
      );
      return run;
    },
    close: () => tail,
  };
}
