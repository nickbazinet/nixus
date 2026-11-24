/**
 * Terms of Service and Privacy Policy text. Section order is the disclosure
 * order AD-13 requires; keep the two documents in step with each other.
 */

export interface LegalDocument {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly intro: string;
  readonly sections: ReadonlyArray<{ readonly heading: string; readonly paragraphs: readonly string[] }>;
  readonly contactHeading: string;
  readonly contactBody: string;
}

export const LEGAL_LAST_UPDATED = "Last updated: 14 October 2026";

export const TERMS: LegalDocument = {
  "title": "Terms of Service — Nixus",
  "description": "The terms that govern your use of the Nixus desktop app, including the optional AI features and Nixus Cloud services.",
  "heading": "Terms of Service",
  "intro": "These terms govern your use of the Nixus desktop app and of the optional Nixus Cloud services. Nixus is alpha software provided as-is.",
  "sections": [
    {
      "heading": "Acceptance",
      "paragraphs": [
        "By installing or using Nixus you agree to these terms and to the Privacy Policy. If you do not agree, do not use the app."
      ]
    },
    {
      "heading": "AI features",
      "paragraphs": [
        "Nixus includes optional AI features. They only run when you invoke them, and running one transmits that request's content — which may include financial transactions and an uploaded statement image or PDF — off your device for processing.",
        "By default you supply your own AI provider credentials (AWS Bedrock or OpenAI). Those requests go directly from your device to that provider under your own agreement with them, and Nixus infrastructure is not involved.",
        "If your account has Nixus Cloud premium enabled, AI requests are instead transmitted through Nixus's own infrastructure to Amazon Bedrock, operated by Amazon Web Services. Nixus selects the model and applies a monthly limit on the number of requests. Processing uses a cross-region Bedrock inference profile scoped to the United States, so a request may be processed in any US AWS region, which may be outside your country of residence. See the Privacy Policy for how this content is handled.",
        "On a premium account, hosted AI takes precedence: an eligible request is sent through Nixus to Amazon Bedrock even when you have configured your own AI provider for that feature. Nixus does not offer an in-app setting to choose between them. Your own provider is used only when hosted AI is unavailable, when your monthly quota is exhausted, or when your account is not premium."
      ]
    },
    {
      "heading": "Request quota",
      "paragraphs": [
        "Premium hosted AI is subject to a monthly request quota and to an overall service capacity limit, both set at Nixus's discretion and adjustable without notice. When your quota is exhausted, when the service is unavailable, or when hosted AI is disabled, Nixus falls back to any AI provider you have configured yourself where that provider supports the feature. Where no fallback is possible, the feature reports an error. No other part of the app is affected."
      ]
    },
    {
      "heading": "Optional Nixus Cloud storage",
      "paragraphs": [
        "Some Nixus Cloud features can keep a copy of your data in Nixus-operated cloud storage. They are available to eligible Nixus Cloud accounts and are off until you turn them on. The Privacy Policy explains how that copy is stored and who could technically read it.",
        "These features are part of the alpha. Their availability is not guaranteed: they may be changed, interrupted, or withdrawn, and transfers may fail or be delayed. Nixus may suspend them for an account, including for abuse or excessive cost. If an account stops being eligible, they stop working, and the app keeps working with your local data."
      ]
    },
    {
      "heading": "Your Nixus Cloud profile",
      "paragraphs": [
        "Every Nixus Cloud account has one profile — first and last name, date of birth, income bracket and its currency, country and state, province, or region, and an optional picture — stored in a Nixus-operated database on Amazon Web Services in the United States. You can edit it from the desktop app or from account.nixusapp.com; both require an internet connection to save. A local profile with no Nixus Cloud account keeps this information on your device only.",
        "account.nixusapp.com uses one essential, first-party cookie to keep you signed in there. Signing in or out on the account website is independent of your desktop app session. \"Delete everything\" in the desktop app removes the on-device copy of your profile but does not delete the Nixus Cloud profile itself; to have that deleted, email the address in the Privacy Policy, which is handled manually today."
      ]
    },
    {
      "heading": "Accounts and premium access",
      "paragraphs": [
        "A Nixus Cloud account is required for hosted AI. Premium hosted-AI capability comes with a paid Nixus Cloud plan that includes it, or is granted by Nixus directly. Nixus may suspend or revoke hosted-AI access, including for abuse or excessive cost."
      ]
    },
    {
      "heading": "Nixus Cloud billing",
      "paragraphs": [
        "Nixus Cloud subscriptions are sold through Stripe. Stripe is the seller of record: you purchase, manage, and cancel your subscription on Stripe-hosted pages opened outside the app, and Stripe is the party you are buying from, not Nixus.",
        "Refunds and disputes go through Stripe. Stripe can issue a refund within 60 days of a charge without needing Nixus's approval, and Nixus takes no action of its own on a dispute beyond recording the resulting subscription state.",
        "Prices are listed in Canadian dollars. If you are outside Canada, you may be charged in your own currency at checkout, at the rate that applies on the day, and tax is included in what you pay. Stripe calculates, collects, and remits that tax, including GST/HST in Canada and VAT across the European Union; Nixus does not handle it directly.",
        "Upgrading to a higher plan takes effect immediately. Downgrading or cancelling takes effect at the end of your current billing period, and if a payment fails, Stripe retries it on its own schedule while your subscription stays live. Losing a paid plan never deletes your data; it only turns off the capability tied to that plan."
      ]
    },
    {
      "heading": "Not professional advice",
      "paragraphs": [
        "Nixus is a tracking tool. Nothing it produces — including AI-generated categorizations, advice, or insights — is tax, legal, accounting, or investment advice. AI output can be wrong. You are responsible for reviewing it before relying on it."
      ]
    },
    {
      "heading": "Your data and backups",
      "paragraphs": [
        "Your records are stored in a local database on your device. Nixus holds no copy of them unless you turn on an optional Nixus Cloud feature, which stores a copy as described above and in the Privacy Policy. Nixus does not operate a backup service, and keeping your own backups is your responsibility."
      ]
    },
    {
      "heading": "Warranty and liability",
      "paragraphs": [
        "Nixus is alpha and is provided \"as is\", without warranty of any kind. To the maximum extent permitted by law, Nixus and its author are not liable for any loss or damage arising from your use of the app, including data loss or decisions made from AI output."
      ]
    },
    {
      "heading": "Changes",
      "paragraphs": [
        "These terms may change as the product develops. Material changes affecting how your data is handled will be reflected here and in the Privacy Policy before the corresponding feature ships."
      ]
    }
  ],
  "contactHeading": "Contact",
  "contactBody": "Questions about these terms:"
};

export const PRIVACY_POLICY: LegalDocument = {
  "title": "Privacy Policy — Nixus",
  "description": "What Nixus stores on your device, what leaves it when you use the AI features, what optional Nixus Cloud storage keeps and who can read it, and how Nixus Cloud premium hosted AI transmits content to AWS Bedrock.",
  "heading": "Privacy Policy",
  "intro": "Nixus is local-first: by default your financial records are stored on your own device and Nixus holds no copy of them. This policy explains the two things that change that, and both are off until you choose them: the optional AI features, and optional Nixus Cloud storage.",
  "sections": [
    {
      "heading": "What stays on your device",
      "paragraphs": [
        "Budgets, transactions, accounts, income, assets, net worth history, vehicles, and maintenance records are stored only in a local database on your machine. There is no account required to use them and no bank connection. By default nothing is uploaded; the two exceptions are the AI features you invoke and optional Nixus Cloud storage, which you have to turn on yourself. AI provider credentials you enter are stored in your operating system's credential store, never transmitted to Nixus."
      ]
    },
    {
      "heading": "Optional Nixus Cloud storage",
      "paragraphs": [
        "Some Nixus Cloud features can keep a copy of your data in Nixus-operated cloud storage. They are off until you turn them on, and they require a Nixus Cloud account. If you never turn them on, or you use a local-only profile, nothing is uploaded.",
        "That copy is stored on Amazon Web Services in the United States and is encrypted in transit and at rest. It is not end-to-end encrypted: Nixus does not read your records, but a Nixus administrator with access to that AWS account could technically do so, and so could AWS.",
        "Turning a cloud feature off stops transfers but does not delete the copy. To have it deleted, email the address at the bottom of this page; requests are handled manually."
      ]
    },
    {
      "heading": "Your Nixus Cloud profile",
      "paragraphs": [
        "Every Nixus Cloud account, including free accounts, has a profile: first and last name, date of birth, income bracket and its currency, country and state, province, or region, and an optional profile picture. It is stored in a Nixus-operated database on Amazon Web Services in the United States, keyed to your account, and is never sold or shared, and never used for advertising.",
        "You edit it from the Nixus desktop app or from account.nixusapp.com; saving a change needs an internet connection either way. The desktop app keeps a read-only copy on your computer so it can show the profile and work offline between edits. Transfers between your device, the account website, and Nixus's servers use TLS.",
        "If you use Nixus without a Nixus Cloud account, your profile stays on that device only and is never uploaded. If you already had a profile on a computer before this feature existed, Nixus asks before uploading it the first time; declining keeps it on that computer and you are not asked again.",
        "\"Delete everything\" in the app removes the copy on that computer, but it does not delete your Nixus Cloud profile, which reappears the next time you sign in anywhere. To have the Nixus Cloud profile itself deleted, email the address at the bottom of this page; this is handled manually today.",
        "account.nixusapp.com uses one essential cookie to keep you signed in on that site. It is first-party, cannot be read by page scripts, and is only sent over an encrypted connection. Signing out of the website does not sign you out of the desktop app, and signing out of the desktop app does not sign you out of the website. This cookie is not an analytics or advertising cookie, and none are added by this feature.",
        "Nixus does not record your profile values, your picture, or any token or cookie in its logs. What it logs for operating the service is your account identifier, the route called, the response status, timing, and sizes."
      ]
    },
    {
      "heading": "Nixus Cloud payments",
      "paragraphs": [
        "Nixus stores no card data of any kind: no card number, no card fragment, no CVV, no raw payment method. There is no path by which card data reaches a Nixus system. Nixus renders no card field on any surface; checkout and subscription management happen on Stripe-hosted pages opened out of process, and Stripe is Nixus's payment processor.",
        "What Nixus does store for billing is your account identifier, your plan, your subscription status, your current billing period's end date, and the customer and subscription identifiers Stripe assigns you. That is used to grant the capabilities your plan includes and to support you if something goes wrong.",
        "Stripe holds everything else about your payment: your card details, your billing address, and your payment history. Stripe's own privacy terms, not this one, govern what it holds and for how long.",
        "Nixus never sells or shares your billing data and never uses it for advertising."
      ]
    },
    {
      "heading": "What leaves your device, and when",
      "paragraphs": [
        "Only when you invoke an AI feature. There is no background transmission. At that point the content of that single request leaves your device. Depending on your configuration that content goes to one of two places."
      ]
    },
    {
      "heading": "Your own AI provider",
      "paragraphs": [
        "By default, the request goes directly from your device to the provider you configured — AWS Bedrock or OpenAI — using your own credentials. Nixus infrastructure is not in that path and cannot see the request. That provider's own privacy terms apply."
      ]
    },
    {
      "heading": "Nixus Cloud premium hosted AI",
      "paragraphs": [
        "If premium hosted AI is enabled on your account, your financial prompts and any uploaded statement image or PDF are transmitted through Nixus's own infrastructure to Amazon Bedrock, operated by Amazon Web Services, for processing.",
        "Note which path a request takes. On a premium account, an eligible request goes through Nixus to Amazon Bedrock even if you have entered your own AWS or OpenAI credentials, and there is no in-app switch to prefer your own provider. Your own credentials are used only when hosted AI is unavailable, out of quota, or not enabled on your account. If you want every request to go directly to your own provider instead, ask us to disable premium hosted AI on your account.",
        "Nixus does not store the prompt, the attached statement, the model's response, or the file name in its own databases or logs. Request content exists in Nixus's systems only in memory, for the duration of that one request."
      ]
    },
    {
      "heading": "Two limits on that guarantee",
      "paragraphs": [
        "The non-retention guarantee above covers Nixus-controlled systems only. It does not bind Amazon Web Services. AWS may process and, under Bedrock's terms and its abuse-detection policies, retain request content. Nixus does not control or override that.",
        "Hosted AI uses a cross-region Amazon Bedrock inference profile scoped to the United States, so an individual request may be processed in any US AWS region and is not confined to a single one. That processing may be outside your country of residence, and AWS's terms for the handling region apply to it."
      ]
    },
    {
      "heading": "Request quota and fallback",
      "paragraphs": [
        "Hosted AI is subject to a monthly request quota. When it is exhausted, unavailable, or disabled, Nixus falls back to any AI provider you configured yourself where that provider supports the feature, and otherwise reports an error. Your records and the rest of the app are unaffected."
      ]
    },
    {
      "heading": "No sale of personal information",
      "paragraphs": [
        "Nixus does not sell your personal information and does not use your financial content to train models."
      ]
    },
    {
      "heading": "Website analytics",
      "paragraphs": [
        "This marketing website uses privacy-preserving aggregate analytics and does not have access to any data from the desktop app."
      ]
    }
  ],
  "contactHeading": "Contact",
  "contactBody": "Questions about this policy, or a request concerning your data:"
};
