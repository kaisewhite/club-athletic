import { z } from "zod";

const name = (label: string) => z.string().trim().min(1, `${label} is required.`).max(80, `${label} must be 80 characters or fewer.`)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), `${label} contains unsupported characters.`);

export const folieDouceVoteSchema = z.object({
  firstName: name("First name"),
  lastName: z.string().trim().max(80, "Last name must be 80 characters or fewer.")
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Last name contains unsupported characters."),
  choice: z.enum(["GENERAL_ADMISSION", "VIP_TABLE"]),
});

export type FolieDouceVoteInput = z.infer<typeof folieDouceVoteSchema>;
