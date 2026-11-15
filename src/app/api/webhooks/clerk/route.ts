import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { createProfileFromClerk, deleteUserData } from "@/features/profiles";
import { logger } from "@/lib/logger";

/**
 * Clerk -> app sync. The signature is verified before anything else
 * (CLERK_WEBHOOK_SIGNING_SECRET). Handlers are idempotent; a 500 makes Clerk retry.
 */
export async function POST(req: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch (error) {
    logger.error("clerk webhook: invalid signature", error);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "user.created":
        await createProfileFromClerk(event.data);
        break;
      case "user.deleted":
        if (event.data.id) await deleteUserData(event.data.id);
        break;
      default:
        break; // other events are intentionally ignored
    }
  } catch (error) {
    logger.error("clerk webhook: handler failed", error, { type: event.type });
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok");
}
