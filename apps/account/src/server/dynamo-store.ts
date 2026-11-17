import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type {
  PreAuthRecord,
  SessionRecord,
  SessionStore,
  SessionTokens,
} from "./store.ts";

/**
 * DynamoDB implementation of the session store.
 *
 * AD-11: this is the ONLY storage the account app touches. Profiles are read and
 * written exclusively through `https://api.nixusapp.com/v1/profile` with the
 * user's own access token, and the account-app role holds nothing on the profile
 * table — the api-account CI guard asserts both directions.
 */

function documentClient(region: string): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function isPreAuth(item: unknown): item is PreAuthRecord {
  return typeof item === "object" && item !== null && (item as PreAuthRecord).type === "preauth";
}

function isSession(item: unknown): item is SessionRecord {
  return typeof item === "object" && item !== null && (item as SessionRecord).type === "session";
}

export function createDynamoSessionStore(
  tableName: string,
  region: string,
  client: DynamoDBDocumentClient = documentClient(region),
): SessionStore {
  return {
    async putPreAuth(record: PreAuthRecord): Promise<void> {
      await client.send(new PutCommand({ TableName: tableName, Item: record }));
    },

    /**
     * Single-use, atomically. The delete is conditional on the item existing and
     * returns it, so a replayed callback — two requests racing with the same
     * cookie — can only have one winner, and the loser sees `null`.
     */
    async consumePreAuth(id: string): Promise<PreAuthRecord | null> {
      try {
        const result = await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { id },
            ConditionExpression: "attribute_exists(id)",
            ReturnValues: "ALL_OLD",
          }),
        );
        return isPreAuth(result.Attributes) ? result.Attributes : null;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
          return null;
        }
        throw error;
      }
    },

    async putSession(record: SessionRecord): Promise<void> {
      await client.send(new PutCommand({ TableName: tableName, Item: record }));
    },

    async getSession(id: string): Promise<SessionRecord | null> {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: { id } }));
      return isSession(result.Item) ? result.Item : null;
    },

    async deleteSession(id: string): Promise<void> {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { id } }));
    },

    async extendSession(id: string, idleExpiresAt: number): Promise<void> {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id },
          // `attribute_exists` keeps a racing sign-out from being resurrected as a
          // bare `{ id, idle_expires_at }` item with no `type`, `sub` or tokens.
          ConditionExpression: "attribute_exists(id) AND #type = :session",
          UpdateExpression: "SET idle_expires_at = :idle, expires_at = :idle",
          ExpressionAttributeNames: { "#type": "type" },
          ExpressionAttributeValues: { ":idle": idleExpiresAt, ":session": "session" },
        }),
      );
    },

    async replaceTokens(id: string, tokens: SessionTokens): Promise<void> {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id },
          ConditionExpression: "attribute_exists(id) AND #type = :session",
          UpdateExpression: "SET tokens = :tokens",
          ExpressionAttributeNames: { "#type": "type" },
          ExpressionAttributeValues: { ":tokens": tokens, ":session": "session" },
        }),
      );
    },
  };
}
