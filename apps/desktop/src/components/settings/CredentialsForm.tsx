import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Input, Label, Badge } from "@nkbaz/shared";
import { ProviderSelector } from "./ProviderSelector";
import { useAiConfig, useInvalidateAiConfig } from "../../hooks/useAiConfig";

type Status = "idle" | "saving" | "success" | "error" | "testing" | "clearing";

interface AppError {
  type?: string;
  message?: string;
}

function getErrorMessage(err: unknown): { type: string; message: string } {
  const e = err as AppError;
  const message =
    e?.message ??
    (typeof err === "string" ? err : JSON.stringify(err, null, 2));
  return {
    type: e?.type ?? "unknown",
    message: message ?? "An unexpected error occurred",
  };
}

export function CredentialsForm() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useAiConfig();
  const invalidateAiConfig = useInvalidateAiConfig();

  const [selectedProvider, setSelectedProvider] = useState<"bedrock" | "openai">(
    config?.provider ?? "bedrock"
  );
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState(config?.region ?? "us-east-1");
  const [apiKey, setApiKey] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [rawError, setRawError] = useState<unknown>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">{t("common.loading", "Loading...")}</div>
    );
  }

  const isConfigured = config?.configured ?? false;
  const activeProvider = config?.provider ?? selectedProvider;

  const handleProviderChange = (v: "bedrock" | "openai") => {
    setSelectedProvider(v);
    setStatusMessage(null);
    setStatus("idle");
  };

  const canSaveBedrock = accessKey.trim() !== "" && secretKey.trim() !== "" && region.trim() !== "";
  const canSaveOpenAI = apiKey.trim() !== "";
  const canSave =
    selectedProvider === "bedrock" ? canSaveBedrock : canSaveOpenAI;

  const handleSave = async () => {
    setStatus("saving");
    setStatusMessage(null);
    setRawError(null);
    try {
      if (selectedProvider === "bedrock") {
        await invoke("save_aws_credentials", {
          access_key: accessKey,
          secret_key: secretKey,
          region,
        });
      } else {
        await invoke("save_openai_credentials", { api_key: apiKey });
      }
      await invalidateAiConfig();
      setStatus("success");
      setStatusMessage(t("settings.saveSuccess", "Credentials saved and verified."));
      // Reset form fields
      setAccessKey("");
      setSecretKey("");
      setApiKey("");
    } catch (err: unknown) {
      const { type, message } = getErrorMessage(err);
      setStatus("error");
      setRawError(err);
      if (type === "invalid_credentials") {
        setStatusMessage(t("settings.invalidCredentials", "Credentials are invalid. Please check and try again."));
      } else {
        setStatusMessage(message);
      }
    }
  };

  const handleTest = async () => {
    setStatus("testing");
    setStatusMessage(null);
    try {
      const result = await invoke<{ status: string; provider: string }>("test_ai_connection");
      setStatus("success");
      setStatusMessage(
        t("settings.testSuccess", "Connection successful ({{provider}}).", {
          provider: result.provider,
        })
      );
    } catch (err: unknown) {
      const { type, message } = getErrorMessage(err);
      setStatus("error");
      setRawError(err);
      if (type === "unavailable") {
        setStatusMessage(t("settings.testUnavailable", "AI service is unreachable. Check your network and credentials."));
      } else if (type === "not_configured") {
        setStatusMessage(t("settings.notConfigured", "AI is not configured yet."));
      } else {
        setStatusMessage(message);
      }
    }
  };

  const handleClearConfirm = async () => {
    setStatus("clearing");
    setStatusMessage(null);
    setConfirmingClear(false);
    try {
      await invoke("clear_ai_credentials");
      await invalidateAiConfig();
      setStatus("idle");
      setStatusMessage(t("settings.credentialsCleared", "Credentials cleared."));
    } catch (err: unknown) {
      const { message } = getErrorMessage(err);
      setStatus("error");
      setStatusMessage(message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Provider selection — always visible when not configured */}
      {!isConfigured && (
        <div className="space-y-3">
          <Label>{t("settings.selectProvider", "Select AI Provider")}</Label>
          <ProviderSelector value={selectedProvider} onChange={handleProviderChange} />
        </div>
      )}

      {/* Current configuration status */}
      {isConfigured && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex-1">
            <p className="text-sm font-medium">
              {activeProvider === "bedrock" ? "AWS Bedrock" : "OpenAI"}
            </p>
            {activeProvider === "bedrock" && config?.region && (
              <p className="text-xs text-muted-foreground">{t("settings.region", "Region")}: {config.region}</p>
            )}
          </div>
          <Badge variant="default" className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20">
            {t("settings.connected", "Connected")}
          </Badge>
        </div>
      )}

      {/* Credential input fields */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">
          {isConfigured
            ? t("settings.updateCredentials", "Update Credentials")
            : t("settings.enterCredentials", "Enter Credentials")}
        </h3>

        {/* Provider selector when reconfiguring */}
        {isConfigured && (
          <div className="space-y-3">
            <Label>{t("settings.selectProvider", "Select AI Provider")}</Label>
            <ProviderSelector value={selectedProvider} onChange={handleProviderChange} />
          </div>
        )}

        {selectedProvider === "bedrock" ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="access-key">{t("settings.accessKeyId", "Access Key ID")}</Label>
              <Input
                id="access-key"
                type="text"
                placeholder={isConfigured ? "••••••••" : t("settings.accessKeyPlaceholder", "AKIA...")}
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="secret-key">{t("settings.secretAccessKey", "Secret Access Key")}</Label>
              <Input
                id="secret-key"
                type="password"
                placeholder={isConfigured ? "••••••••" : t("settings.secretKeyPlaceholder", "Enter secret key")}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="region">{t("settings.region", "Region")}</Label>
              <Input
                id="region"
                type="text"
                placeholder="us-east-1"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="api-key">{t("settings.apiKey", "API Key")}</Label>
            <Input
              id="api-key"
              type="password"
              placeholder={isConfigured ? "••••••••" : "sk-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {/* Status message */}
      {statusMessage && (
        <p
          className={
            status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-emerald-600 dark:text-emerald-400"
          }
        >
          {statusMessage}
        </p>
      )}
      {status === "error" && rawError !== null && (
        <pre className="rounded bg-muted p-3 text-xs text-muted-foreground overflow-auto max-h-40 whitespace-pre-wrap">
          {typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2)}
        </pre>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleSave}
          disabled={!canSave || status === "saving" || status === "clearing"}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === "saving"
            ? t("settings.saving", "Saving...")
            : t("settings.saveCredentials", "Save Credentials")}
        </button>

        {isConfigured && (
          <button
            onClick={handleTest}
            disabled={status === "testing" || status === "saving" || status === "clearing"}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {status === "testing"
              ? t("settings.testing", "Testing...")
              : t("settings.testConnection", "Test Connection")}
          </button>
        )}

        {isConfigured && !confirmingClear && (
          <button
            onClick={() => setConfirmingClear(true)}
            disabled={status === "saving" || status === "clearing"}
            className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            {t("settings.clearCredentials", "Clear Credentials")}
          </button>
        )}

        {confirmingClear && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("settings.confirmClear", "Remove stored credentials?")}
            </span>
            <button
              onClick={handleClearConfirm}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground"
            >
              {t("common.confirm")}
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
