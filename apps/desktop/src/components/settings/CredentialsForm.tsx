import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Input,
  Label,
  Skeleton,
} from "@nixus/shared";
import { ProviderSelector } from "./ProviderSelector";
import { SettingRow } from "./SettingRow";
import { useAiConfig, useInvalidateAiConfig } from "../../hooks/useAiConfig";

type Status = "idle" | "saving" | "success" | "error" | "testing" | "clearing";
type Provider = "bedrock" | "openai";
type FieldName = "accessKey" | "secretKey" | "region" | "apiKey";

interface AppError {
  type?: string;
  message?: string;
}

function getErrorMessage(err: unknown): { type: string; message: string } {
  const e = err as AppError;
  const message =
    e?.message ?? (typeof err === "string" ? err : JSON.stringify(err, null, 2));
  return {
    type: e?.type ?? "unknown",
    message: message ?? "An unexpected error occurred",
  };
}

export function CredentialsForm() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useAiConfig();
  const invalidateAiConfig = useInvalidateAiConfig();

  const [selectedProvider, setSelectedProvider] = useState<Provider>(
    config?.provider ?? "bedrock"
  );
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState(config?.region ?? "us-east-1");
  const [apiKey, setApiKey] = useState("");
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    accessKey: false,
    secretKey: false,
    region: false,
    apiKey: false,
  });

  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [rawError, setRawError] = useState<unknown>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [tested, setTested] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <Skeleton rows={4} className="px-card-pad" />
      </Card>
    );
  }

  const isConfigured = config?.configured ?? false;
  const activeProvider = config?.provider ?? selectedProvider;

  const markTouched = (field: FieldName) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const handleProviderChange = (v: Provider) => {
    setSelectedProvider(v);
    setStatusMessage(null);
    setStatus("idle");
  };

  const errors = {
    accessKey: accessKey.trim() === "",
    secretKey: secretKey.trim() === "",
    region: region.trim() === "",
    apiKey: apiKey.trim() === "",
  };
  const canSave =
    selectedProvider === "bedrock"
      ? !errors.accessKey && !errors.secretKey && !errors.region
      : !errors.apiKey;
  const busy = status === "saving" || status === "clearing" || status === "testing";

  const handleSave = async () => {
    setTouched({ accessKey: true, secretKey: true, region: true, apiKey: true });
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
      setTested(false);
      setStatusMessage(t("settings.saveSuccess"));
      setAccessKey("");
      setSecretKey("");
      setApiKey("");
      setTouched({ accessKey: false, secretKey: false, region: false, apiKey: false });
    } catch (err: unknown) {
      const { type, message } = getErrorMessage(err);
      setStatus("error");
      setRawError(err);
      setStatusMessage(
        type === "invalid_credentials" ? t("settings.invalidCredentials") : message
      );
    }
  };

  const handleTest = async () => {
    setStatus("testing");
    setStatusMessage(null);
    try {
      const result = await invoke<{ status: string; provider: string }>(
        "test_ai_connection"
      );
      setStatus("success");
      setTested(true);
      setStatusMessage(t("settings.testSuccess", { provider: result.provider }));
    } catch (err: unknown) {
      const { type, message } = getErrorMessage(err);
      setStatus("error");
      setRawError(err);
      setStatusMessage(
        type === "unavailable"
          ? t("settings.testUnavailable")
          : type === "not_configured"
            ? t("settings.notConfigured")
            : message
      );
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
      setTested(false);
      setStatusMessage(t("settings.credentialsCleared"));
    } catch (err: unknown) {
      const { message } = getErrorMessage(err);
      setStatus("error");
      setStatusMessage(message);
    }
  };

  return (
    <div className="space-y-3">
      <Card flush>
        <SettingRow
          title={t("settings.providerLegend")}
          description={t("settings.providerDescription")}
        />
        <div className="px-card-pad pb-3.5">
          <ProviderSelector value={selectedProvider} onChange={handleProviderChange} />
        </div>

        {isConfigured && (
          <SettingRow
            title={t("settings.connectionTitle")}
            description={
              tested ? t("settings.connectionChecked") : t("settings.connectionUnchecked")
            }
            control={
              <span className="flex items-center gap-2">
                <Badge variant={tested ? "good" : "neutral"}>
                  {tested ? t("settings.connected") : activeProvider}
                </Badge>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={busy}
                  aria-disabled={busy || undefined}
                  data-testid="credentials-test"
                >
                  {status === "testing" ? t("settings.testing") : t("settings.testAgain")}
                </Button>
              </span>
            }
            data-testid="setting-connection"
          />
        )}
      </Card>

      <Card>
        <div className="space-y-3 px-card-pad">
          <h4 className="text-h3 text-ink">
            {isConfigured
              ? t("settings.updateCredentials")
              : t("settings.enterCredentials")}
          </h4>

          {selectedProvider === "bedrock" ? (
            <>
              <Field
                id="access-key"
                label={t("settings.accessKeyId")}
                hint={t("settings.keychainNote")}
                error={touched.accessKey && errors.accessKey ? t("settings.accessKeyRequired") : null}
              >
                <Input
                  id="access-key"
                  type="text"
                  placeholder={isConfigured ? "••••••••" : t("settings.accessKeyPlaceholder")}
                  value={accessKey}
                  required
                  aria-required="true"
                  aria-invalid={(touched.accessKey && errors.accessKey) || undefined}
                  aria-describedby="access-key-hint access-key-error"
                  autoComplete="off"
                  onBlur={() => markTouched("accessKey")}
                  onChange={(e) => setAccessKey(e.target.value)}
                />
              </Field>
              <Field
                id="secret-key"
                label={t("settings.secretAccessKey")}
                hint={t("settings.secretKeyNote")}
                error={touched.secretKey && errors.secretKey ? t("settings.secretKeyRequired") : null}
              >
                <Input
                  id="secret-key"
                  type="password"
                  placeholder={isConfigured ? "••••••••" : t("settings.secretKeyPlaceholder")}
                  value={secretKey}
                  required
                  aria-required="true"
                  aria-invalid={(touched.secretKey && errors.secretKey) || undefined}
                  aria-describedby="secret-key-hint secret-key-error"
                  autoComplete="off"
                  onBlur={() => markTouched("secretKey")}
                  onChange={(e) => setSecretKey(e.target.value)}
                />
              </Field>
              <Field
                id="region"
                label={t("settings.region")}
                hint={t("settings.regionNote")}
                error={touched.region && errors.region ? t("settings.regionRequired") : null}
              >
                <Input
                  id="region"
                  type="text"
                  placeholder="ca-central-1"
                  value={region}
                  required
                  aria-required="true"
                  aria-invalid={(touched.region && errors.region) || undefined}
                  aria-describedby="region-hint region-error"
                  onBlur={() => markTouched("region")}
                  onChange={(e) => setRegion(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field
              id="api-key"
              label={t("settings.apiKey")}
              hint={t("settings.keychainNote")}
              error={touched.apiKey && errors.apiKey ? t("settings.apiKeyRequired") : null}
            >
              <Input
                id="api-key"
                type="password"
                placeholder={isConfigured ? "••••••••" : "sk-..."}
                value={apiKey}
                required
                aria-required="true"
                aria-invalid={(touched.apiKey && errors.apiKey) || undefined}
                aria-describedby="api-key-hint api-key-error"
                autoComplete="off"
                onBlur={() => markTouched("apiKey")}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>
          )}

          {statusMessage !== null && (
            <Alert variant={status === "error" ? "over" : "info"}>
              <AlertDescription className={status === "error" ? "text-ink" : undefined}>
                {statusMessage}
              </AlertDescription>
              {status === "error" && rawError !== null && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-sm bg-track p-2 text-caption whitespace-pre-wrap text-ink-dim">
                  {typeof rawError === "string"
                    ? rawError
                    : JSON.stringify(rawError, null, 2)}
                </pre>
              )}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={!canSave || busy}
              aria-disabled={!canSave || busy || undefined}
              aria-describedby={!canSave ? "credentials-save-blocked" : undefined}
              data-testid="credentials-save"
            >
              {status === "saving" ? t("settings.saving") : t("settings.saveCredentials")}
            </Button>
            {!canSave && (
              <p id="credentials-save-blocked" className="text-caption text-ink-dim">
                {selectedProvider === "bedrock"
                  ? t("settings.accessKeyRequired")
                  : t("settings.apiKeyRequired")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {isConfigured && (
        <Card flush>
          {confirmingClear ? (
            <Alert variant="caution" data-testid="credentials-clear-confirm">
              <AlertTitle>{t("settings.confirmClear")}</AlertTitle>
              <AlertDescription className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleClearConfirm}
                  data-testid="credentials-clear-confirm-button"
                >
                  {t("common.confirm")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingClear(false)}
                >
                  {t("common.cancel")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <SettingRow
              title={t("settings.clearCredentials")}
              control={
                <Button
                  variant="outline"
                  onClick={() => setConfirmingClear(true)}
                  disabled={busy}
                  aria-disabled={busy || undefined}
                  data-testid="credentials-clear"
                >
                  {status === "clearing"
                    ? t("settings.clearing")
                    : t("settings.clearCredentials")}
                </Button>
              }
              data-testid="setting-clear-credentials"
            />
          )}
        </Card>
      )}
    </div>
  );
}

// Required marker plus validate-on-blur in one place: submit-only validation with no markers is a
// banned pattern, and it is the pattern every sampled form in this app used.
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} required>
        {label}
      </Label>
      {children}
      <p id={`${id}-hint`} className="text-caption text-ink-dim">
        {hint}
      </p>
      <p
        id={`${id}-error`}
        className="text-caption text-over-ink empty:hidden"
        role={error === null ? undefined : "alert"}
      >
        {error}
      </p>
    </div>
  );
}
