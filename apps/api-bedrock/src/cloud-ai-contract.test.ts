import { describe, expect, it } from "vitest";

import type {
  CloudAiContent,
  CloudAiErrorResponse,
  CloudAiFrame,
  CloudAiInvokeRequest,
  CloudAiStatusResponse,
} from "@nixus/shared";

describe("@nixus/api-bedrock consumption of the shared cloud-AI contract", () => {
  it("compiles an invoke-request fixture against the root shared type export", () => {
    const request: CloudAiInvokeRequest = {
      operation: "statement_import",
      system: "Extract transactions from the attached statement.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Categorize these transactions." },
            { type: "document", format: "pdf", data_base64: "ZG9jLXBkZg==" },
          ],
        },
      ],
      client_request_id: "9f8b1e0c-77a2-4f4e-8a1d-1c9f5b3e2d10",
    };

    const contentTypes = request.messages.flatMap((message) =>
      message.content.map((content: CloudAiContent) => content.type)
    );

    expect(request.operation).toBe("statement_import");
    expect(contentTypes).toEqual(["text", "document"]);
    expect(request.client_request_id).toBe(
      "9f8b1e0c-77a2-4f4e-8a1d-1c9f5b3e2d10"
    );
  });

  it("compiles status, frame, and pre-output error fixtures against the same root export", () => {
    const status: CloudAiStatusResponse = {
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: "2026-08",
    };
    const frames: readonly CloudAiFrame[] = [
      { type: "meta", operation: "chat", request_id: "req-1" },
      { type: "delta", text: "hello" },
      {
        type: "end",
        stop_reason: "max_tokens",
        input_tokens: 10,
        output_tokens: 20,
      },
      { type: "error", code: "hosted_unavailable", message: "upstream failed" },
    ];
    const preOutputError: CloudAiErrorResponse = {
      error: {
        code: "quota_exhausted",
        message: "monthly request limit reached",
        request_id: "req-2",
      },
    };

    expect(status.premium).toBe(false);
    expect(frames.map((frame) => frame.type)).toEqual([
      "meta",
      "delta",
      "end",
      "error",
    ]);
    expect(preOutputError.error.code).toBe("quota_exhausted");
  });
});
