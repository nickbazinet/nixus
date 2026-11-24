/**
 * English copy — the source language. Every string here must have a French
 * counterpart in `fr.ts`; `SiteCopy` is what enforces that.
 */

import { TERMS_EN, PRIVACY_POLICY_EN } from "./legal.en";
import type { SiteCopy } from "./types";

export const EN: SiteCopy = {
  shell: {
    skipToMain: "Skip to main content",
    announcement: {
      text: "Alpha: Founding Users get early access and a discounted price, forever.",
      cta: "See the program",
    },
    header: {
      homeAria: "Nixus home",
      navAria: "Main",
      nav: {
        features: "Features",
        pricing: "Pricing",
        mission: "Our mission",
        privacy: "Privacy",
        foundingUsers: "Founding Users",
      },
      logIn: "Log in",
      getStarted: "Get started",
      openMenu: "Open menu",
      closeMenu: "Close menu",
    },
    language: {
      label: "Language",
      short: { en: "EN", fr: "FR" },
      name: { en: "English", fr: "French" },
      switchTo: "View this page in {language}",
    },
    footer: {
      tagline: "Minus the admin. Personal finance for Canadians.",
      columns: {
        product: "Product",
        company: "Company",
        follow: "Follow",
        legal: "Legal",
      },
      links: {
        features: "Features",
        pricing: "Pricing",
        download: "Download",
        mission: "Our mission",
        foundingUsers: "Founding Users",
        github: "GitHub",
        instagram: "Instagram",
        facebook: "Facebook",
        privacy: "Privacy",
        privacyPolicy: "Privacy policy",
        terms: "Terms",
      },
    },
  },

  meta: {
    ogImageAlt: "Nixus — personal finance, minus the admin.",
    siteDescription:
      "Nixus subtracts the spreadsheets, the chaos and the stress. Drop in a credit card statement and get a clear picture of where you stand and what to do next. Free on your computer, no bank logins.",
    pages: {
      home: {
        title: "Nixus — Personal finance, minus the admin",
        description:
          "Nixus subtracts the spreadsheets, the chaos and the stress. Drop in a credit card statement and get a clear picture of where you stand and what to do next. Free on your computer, no bank logins.",
      },
      features: {
        title: "Features — Nixus",
        description:
          "Statement import in seconds, next actions, TFSA, RRSP and FHSA tracking, budgets and net worth history. Personal finance with the busywork taken out.",
      },
      pricing: {
        title: "Pricing — Nixus",
        description:
          "Nixus is free on your computer and needs no account. NixusCloud adds household views and AI, and Advance monthly starts with a 7-day free trial you can cancel any time before it ends.",
      },
      mission: {
        title: "Our mission — Nixus",
        description:
          "Improve the financial stability of the average Canadian. Why Nixus exists, what it promises, and what it cannot do yet.",
      },
      privacy: {
        title: "Privacy — Nixus",
        description:
          "No bank logins. Your records live on your computer, and nothing leaves it until you sign in with a Nixus Cloud account. Exactly what leaves your computer, and when.",
      },
      foundingUsers: {
        title: "Founding Users — Nixus",
        description:
          "Help build Nixus. Founding Users get early access at a discounted price for good, in exchange for honest feedback.",
      },
      download: {
        title: "Download Nixus for macOS and Windows",
        description:
          "Download Nixus for macOS or Windows. Free on your computer, no account needed.",
      },
      terms: {
        title: "Terms of Service — Nixus",
        description:
          "The terms that govern your use of the Nixus desktop app, including the optional AI features and Nixus Cloud services.",
      },
      privacyPolicy: {
        title: "Privacy Policy — Nixus",
        description:
          "What Nixus stores on your device, what leaves it when you use the AI features, what optional Nixus Cloud storage keeps and who can read it, and how Nixus Cloud premium hosted AI transmits content to AWS Bedrock.",
      },
      notFound: {
        title: "Page not found — Nixus",
        description: "This page does not exist.",
      },
    },
  },

  visuals: {
    hero: {
      spendingLabel: "Spending this month",
      spendingDelta: "-6%",
      spendingAmount: "$3,480",
      breakdown: "Breakdown",
      slices: [
        { label: "Housing", share: "42%" },
        { label: "Food", share: "28%" },
        { label: "Transport", share: "18%" },
      ],
      reminderTitle: "Quick reminder",
      reminderBody: "You are at 68% of your goal.",
    },
    tourVideoLabel: "Nixus importing a statement and sorting it into categories",
    importCategories: ["Groceries", "Dining out", "Transport"],
    registeredAccounts: [
      { label: "TFSA", amount: "$46,100" },
      { label: "RRSP", amount: "$37,100" },
      { label: "FHSA", amount: "$19,200" },
    ],
  },

  home: {
    hero: {
      kicker: "Personal finance for Canadians",
      heading: { lead: "Minus the ", accent: "admin", tail: "." },
      lead: "Nixus subtracts the spreadsheets, the chaos and the stress. You get a clear picture of where you stand and what to do next. Drop in a credit card statement to start.",
      ctaDownload: "Download Nixus",
      ctaFeatures: "See the features",
      platforms: "macOS and Windows. Free on your computer, no account needed. No bank logins.",
      trialLead: "AI statement reading comes with NixusCloud Advance.",
      trialLink: "Try it free for 7 days",
    },
    minus: {
      heading: { first: "Minus", rest: "the ", accent: "admin" },
      subtracted: [
        "the headache",
        "the chaos",
        "the spreadsheets",
        "the complexity",
        "the overwhelm",
        "the confusion",
        "the worries",
      ],
      pitchHeading: "We subtract the busywork. You add the decisions.",
      pitchBody:
        "Nixus sorts your transactions, tracks your budgets and keeps your net worth up to date. You spend your time on the choices that actually move your money.",
      missionLink: "Read our mission",
    },
    features: {
      kicker: "Features",
      heading: "From statement to sorted in seconds",
      body: "Drop in a credit card statement as a PDF or a screenshot. Nixus reads every transaction and puts it in a category.",
      trialNote:
        "Reading statements with AI is part of NixusCloud Advance, which starts with 7 days free. A card is required and you can cancel before the trial ends.",
      highlights: [
        {
          title: "Next actions",
          body: "A chart tells you what happened. Nixus tells you what to do now.",
        },
        {
          title: "TFSA, RRSP and FHSA",
          body: "Registered accounts are first-class, not an afterthought.",
        },
        {
          title: "Net worth over time",
          body: "Assets and liabilities in one history, so you see the direction.",
        },
      ],
      link: "Explore every feature",
    },
    how: {
      kicker: "How it works",
      heading: "Up and running in three steps",
      steps: [
        {
          title: "Download Nixus",
          body: "Install Nixus on macOS or Windows. No account needed.",
        },
        {
          title: "Drop in a statement",
          body: "A PDF or screenshot from your credit card. Nixus sorts it.",
        },
        {
          title: "See where you stand",
          body: "Budgets, net worth and your next actions, ready to go.",
        },
      ],
    },
    mission: {
      kicker: "Our mission",
      heading: "Improve the financial stability of the average Canadian.",
      body: "Knowledge and guidance for everyday people, with the routine decisions automated. Built by one person who wanted this to exist.",
      cta: "Read the story",
    },
    pricing: {
      kicker: "Pricing",
      headingLines: ["Free on your computer.", "Cloud when you want it."],
      trialThen: ", then the monthly price.",
      compareLink: "Compare the plans",
    },
    founding: {
      kicker: "Founding Users",
      heading: "Help build Nixus. Get it first, and pay less, forever.",
      body: "Early access to the platform at a discounted price for good, in exchange for honest feedback and regular conversations with me.",
      cta: "Become a Founding User",
    },
    closing: {
      kicker: "We subtract. You add.",
      heading: {
        lead: "Stop running a spreadsheet. ",
        accent: "Start running your money.",
        tail: "",
      },
      subtractTitle: "We subtract",
      subtractItems: [
        "The spreadsheet you rebuild every month",
        "Sorting every transaction by hand",
        "Guessing what to do with what is left",
      ],
      addTitle: "You add",
      addItems: [
        "A clear view of where you stand",
        "A next step every time you open it",
        "Confidence in your money decisions",
      ],
      footnote: "Free on your computer. No account and no bank login.",
      trialFootnote:
        "Want the AI statement import? NixusCloud Advance is free for your first 7 days.",
      cta: "Download Nixus",
    },
  },

  features: {
    kicker: "Features",
    heading: { first: "Less busywork.", accent: "More clarity", tail: "." },
    lead: "Nixus takes the busywork out of money, so what is left is the part that matters: knowing where you stand and deciding what to do next.",
    subtractTitle: "We subtract",
    subtractItems: [
      "Typing in transactions by hand",
      "Sorting every purchase into a category",
      "Wondering what to do next",
      "Juggling separate sheets for each account",
    ],
    addTitle: "You add",
    addItems: [
      "A clear view of your net worth and budgets",
      "A short list of next actions each time you open it",
      "TFSA, RRSP and FHSA tracked next to everything else",
      "Confidence in your money decisions",
    ],
    ctaDownload: "Download Nixus",
    ctaPricing: "See the plans",
    rows: [
      {
        heading: "From statement to sorted in seconds",
        body: "Drop in a credit card statement as a PDF or a screenshot. Nixus reads every transaction and puts it in a category, so the typing is gone.",
        points: [
          "PDF and screenshot import",
          "Automatic categories you can correct",
          "Statements kept private, never used to train AI",
          "Part of NixusCloud Advance, free for your first 7 days",
        ],
      },
      {
        heading: "A chart tells you what happened. Nixus tells you what to do.",
        body: "Every time you open the app you get a short list of next actions, from a budget that is slipping to contribution room you have not used.",
        points: [
          "Prioritized, short, specific",
          "Based on your own numbers",
          "Plain language, no jargon",
        ],
      },
      {
        heading: "TFSA, RRSP and FHSA as first-class citizens",
        body: "Track your registered accounts next to everything else, so the accounts that matter most to Canadians are not an afterthought.",
        points: [
          "Balances for each registered account",
          "Contribution room at a glance",
          "Included in your net worth",
        ],
      },
      {
        heading: "Budgets and net worth, month after month",
        body: "See each category against its limit, and watch assets and liabilities settle into one timeline you can trust.",
        points: [
          "Category budgets with clear over and under",
          "Net worth history from 1M to all time",
          "Everything computed on your computer",
        ],
      },
    ],
    toolbox: {
      kicker: "And more",
      heading: "The rest of the toolbox",
      body: "From daily cash flow to retirement, and even your car: everything else Nixus keeps organized for you.",
      items: [
        {
          title: "Cash flow, clearly",
          body: "Track every expense and income so you always know what came in, what went out and what is left.",
        },
        {
          title: "Every account, CAD and USD",
          body: "Banks, cards, investments, real estate and more, in Canadian and US dollars, in one place.",
        },
        {
          title: "Savings goals",
          body: "Plan the things you are saving for, fund them over time and see how close you are.",
        },
        {
          title: "Trends and year in review",
          body: "Spot spending trends as they form, then look back on the whole year at a glance.",
        },
        {
          title: "Forecasts and retirement",
          body: "Project your net worth forward and test your retirement plan before you commit to it.",
        },
        {
          title: "A garage for every vehicle",
          body: "Keep several vehicles, with service schedules, full history and alerts before maintenance is due.",
        },
        {
          title: "Ask about your money",
          body: "Ask questions in plain language, like where last month went, and get an answer from your own numbers.",
        },
        {
          title: "Ask about your car",
          body: "Wondering when the next oil change is due? Ask, and the answer comes from your service history.",
        },
        {
          title: "Private by design",
          body: "No bank logins and no bank connection. Your records stay on your computer.",
        },
      ],
      privacyLink: "How we protect your data",
    },
    why: {
      kicker: "Why Nixus",
      heading: "Most people choose between work and trust",
      lead: "Nixus is the third option.",
      cards: [
        {
          title: "A spreadsheet",
          body: "You stay in control, and you do all the typing. It tells you what happened only if you build it to.",
        },
        {
          title: "Bank-connected apps",
          body: "Automatic, but they typically want your bank credentials and keep your data on their servers.",
        },
        {
          title: "Nixus",
          body: "Import a statement in seconds. Your records stay on your computer. You get told what to do next.",
        },
      ],
    },
    closing: {
      heading: "Try it on your own statement",
      body: "Free on your computer, no account needed. AI statement import is part of NixusCloud Advance, which starts with 7 days free — a card is required, and you can cancel before the trial ends.",
      cta: "Download Nixus",
    },
  },

  pricing: {
    kicker: "Pricing",
    heading: { first: "Free on your computer.", accent: "Cloud Capabilities", tail: " when you want it." },
    lead: "Using Nixus on your computer costs nothing and needs no account. NixusCloud adds household views and AI, and Advance starts with 7 days free.",
    taxNote:
      "Prices are in Canadian dollars and tax is included. Outside Canada, checkout shows the price in your own currency. Payments are handled by Stripe.",
    plans: {
      free: {
        name: "Nixus Free",
        shortName: "Free",
        tagline: "Your own profile, on your computer. No account needed.",
        teaser: "Your own profile, on your computer. No account needed.",
        features: [
          "Budgets and net worth history",
          "TFSA, RRSP and FHSA tracking",
          "Next actions and Garage",
        ],
      },
      classic: {
        name: "NixusCloud Classic",
        shortName: "Classic",
        tagline: "Your money, across your whole household.",
        teaser: "Household net worth, in one view.",
        features: ["Everything in Free", "Household net worth"],
      },
      advance: {
        name: "NixusCloud Advance",
        shortName: "Advance",
        tagline: "Classic, plus AI guidance and dashboards you can shape.",
        teaser: "Adds AI integration and custom dashboards.",
        badge: "AI included",
        features: [
          "Everything in Classic",
          "AI statement import and categories",
          "AI assistants",
          "Custom dashboards",
        ],
      },
    },
    trial: {
      badge: "7 days free",
      cta: "Start 7-day free trial",
      microcopy:
        "7 days free, then {price}. A card is required. Cancel anytime before the trial ends and you won't be charged.",
      secondaryCta: "Or subscribe now, without a trial",
    },
    choosePlan: "Choose {plan}",
    downloadCta: "Download Nixus",
    compare: {
      heading: "Compare the plans",
      lead: "Everything you need to track your money is free on your computer. Cloud plans add the household view, AI that answers from your own numbers, and dashboards built your way.",
      caption: "Features included in each Nixus plan",
      featureColumn: "Feature",
      included: "Included",
      notIncluded: "Not included",
      groups: [
        {
          rows: [
            {
              label: "Budgets and cash flow",
              hint: "Monthly budgets, expenses and income, and where you stand.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Accounts and assets in CAD and USD",
              hint: "Banks, cards, investments and real estate.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Net worth history",
              hint: "Watch it grow over time, from 1M to all time.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "TFSA, RRSP and FHSA tracking",
              hint: "Balances and contribution room next to everything else.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Savings goals",
              hint: "Plan and fund what you are saving for.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Insights, forecasts and retirement planning",
              hint: "Spending trends, a year in review and net worth projections.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Next actions",
              hint: "A short, prioritized list each time you open the app.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Garage with service alerts",
              hint: "Multiple vehicles, service history and due-date alerts.",
              values: { free: true, classic: true, advance: true },
            },
          ],
        },
        {
          rows: [
            {
              label: "Cloud backup and sync",
              hint: "Free keeps everything on your computer only. Cloud keeps a safe copy and syncs your devices, so a lost or broken computer does not mean lost records.",
              values: { free: false, classic: true, advance: true },
            },
            {
              label: "Household net worth",
              hint: "One view of what your household owns and owes.",
              values: { free: false, classic: true, advance: true },
            },
          ],
        },
        {
          rows: [
            {
              label: "AI statement import and categories",
              hint: "Drop in a PDF or screenshot and every transaction is read and sorted.",
              values: { free: false, classic: false, advance: true },
            },
            {
              label: "AI assistant for your money",
              hint: "Ask in plain language where your money went and get answers from your own numbers.",
              values: { free: false, classic: false, advance: true },
            },
            {
              label: "AI assistant for your car",
              hint: "Ask about service schedules and history.",
              values: { free: false, classic: false, advance: true },
            },
            {
              label: "Custom dashboards",
              hint: "Build the overview you want, with the numbers you care about.",
              values: { free: false, classic: false, advance: true },
            },
          ],
        },
        {
          rows: [
            {
              label: "No bank logins or bank connection",
              hint: "You choose which statements to import, on every plan.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Account required",
              values: { free: "No", classic: "Yes", advance: "Yes" },
            },
            {
              label: "Free trial",
              hint: "Advance monthly starts with 7 days free. A card is required, and it continues as a paid monthly plan unless you cancel before the trial ends.",
              values: { free: "Not needed", classic: "No", advance: "7 days" },
            },
          ],
        },
      ],
    },
    founding: {
      kicker: "Founding Users",
      heading: "Early access, at a discounted price, forever.",
      body: "Join the alpha early, share what works and what does not, and keep a lower price for good.",
      cta: "See the program",
    },
    faqHeading: "Pricing questions",
    faq: [
      {
        question: "Do I need an account?",
        answer:
          "Not for Nixus Free. You create a profile on your own computer and that is it. An account is only needed for NixusCloud, because household views and AI run through it.",
      },
      {
        question: "Is Nixus on my computer really free?",
        answer:
          "Yes. Budgets, cash flow, net worth history, registered accounts, savings goals, next actions and Garage all work on your computer at no cost, with no time limit and no card. It is not a trial that runs out. The 7-day free trial is a separate thing: it lets you try the paid NixusCloud Advance features before you pay for them.",
      },
      {
        question: "How does the free trial work?",
        answer:
          "NixusCloud Advance monthly starts with 7 days free. You sign in, enter a card on Stripe's secure page, and get every Advance feature straight away — AI statement import, the AI assistants, custom dashboards and the household view. The trial applies to Advance monthly only, not to the yearly price and not to Classic.",
      },
      {
        question: "Will I be charged during the trial?",
        answer:
          "No. A card is required when you start, because the trial turns into a paid subscription on its own, but nothing is charged for the first 7 days. Stripe may briefly verify the card, which some banks show as a temporary hold and never as a charge.",
      },
      {
        question: "What happens when the trial ends?",
        answer:
          "On day 8 your subscription continues automatically as paid NixusCloud Advance monthly, at the price shown above, and your card is charged then. It renews each month until you cancel. Stripe emails you before the trial ends so the charge is never a surprise.",
      },
      {
        question: "Can I cancel during the trial?",
        answer:
          "Yes, at any point before it ends, and you will not be charged. Go to account.nixusapp.com, open Manage plan, and cancel in Stripe's billing portal. You keep Advance until the day the trial was due to end, then the account goes back to the free plan. Nothing on your computer is lost either way: your records live in a file on your own machine.",
      },
      {
        question: "Can I use the free trial more than once?",
        answer:
          "The trial is meant as one per person, and Nixus may decline a repeat trial. If you have had Advance before, you can still subscribe at the regular price at any time.",
      },
      {
        question: "Do I need to connect my bank?",
        answer:
          "No. Nixus never asks for your bank login. You import a credit card statement as a PDF or a screenshot, and you choose which ones.",
      },
      {
        question: "Can I cancel NixusCloud and keep my data?",
        answer:
          "Yes. Your records live on your computer, so cancelling only turns off the cloud features tied to your plan. It never deletes what is on your machine.",
      },
      {
        question: "What happens if the alpha stops being updated?",
        answer:
          "Your data is a file on your own computer and the code is open source, so the app keeps working with what you have, and anyone can read or build the code.",
      },
      {
        question: "Who do I pay, and are taxes included?",
        answer:
          "Stripe sells NixusCloud and is the seller of record, so you pay on Stripe's secure pages and Nixus never sees or stores your card. Prices are listed in Canadian dollars with tax included, and outside Canada checkout shows the price in your own currency. You can cancel, update your card and switch plans from your account, and refunds go through Stripe.",
      },
      {
        question: "Is this financial advice?",
        answer:
          "No. Nixus is a tool for tracking and organizing your money. Its suggestions are educational, not tax, legal or investment advice, and you decide what to do.",
      },
    ],
  },

  mission: {
    kicker: "Our mission",
    heading: {
      lead: "Improve the financial stability of the ",
      accent: "average Canadian",
      tail: ".",
    },
    lead: "Not a finance expert. Not someone with a spare weekend. The average person, with a real life and a budget to run.",
    goals: {
      kicker: "How we get there",
      heading: "Four goals",
      items: [
        {
          title: "Knowledge and guidance",
          body: "Best practices for average people, in plain language. No finance degree needed.",
        },
        {
          title: "Automate financial decisions",
          body: "Let the app handle the routine choices, so good habits become the default.",
        },
        {
          title: "Automate the rest of life",
          body: "Money is the start. Garage already tracks vehicle upkeep, and more will follow.",
        },
        {
          title: "Use technology to do it",
          body: "Your data stays on your computer, the code is open source, and AI is used only where it helps and you opt in.",
        },
      ],
    },
    founder: {
      photoAlt: "Nick, founder of Nixus",
      name: "Nick",
      role: "Founder of Nixus",
      kicker: "Why I’m building this",
      heading: "Built by one person who wanted this to exist",
      paragraphs: [
        "I have built my own budget for years. Every time I talked money with the people around me, I found the same thing: we had all built it ourselves, one spreadsheet at a time.",
        "Getting financially responsible changed my life for the better. I want everyone around me to have that, without reinventing the wheel. So I am bringing automation and best practices to everybody.",
        "I wanted a tool that tells you what to do next, not just what happened, without handing a company your bank password. Nixus is in alpha, it is open source, and I will tell you plainly what it cannot do yet. If you try it, you get a direct line to me.",
      ],
    },
    promises: {
      kicker: "Promises",
      heading: "What you can hold me to",
      items: [
        {
          title: "Your records stay yours",
          body: "Your data stays on your computer by design. Cloud features are opt-in.",
        },
        { title: "Open source", body: "Read the code, not just the promise." },
        {
          title: "Plain about limits",
          body: "I will say what Nixus cannot do yet, before you find out.",
        },
      ],
      worksTitle: "What works today",
      worksItems: [
        "Importing credit card statements",
        "Budgets and cash flow",
        "Net worth history and forecasts",
        "Spending insights and year in review",
        "Retirement projections",
        "Investment overview",
        "Registered account tracking (TFSA, RRSP, FHSA)",
        "Savings goals",
        "Car maintenance garage",
      ],
      isntTitle: "What it isn’t",
      isntItems: ["No bank connection", "No mobile app (yet)", "Not professional financial advice"],
    },
    closing: {
      heading: "Help me build it",
      body: "Founding Users shape Nixus from the start, and keep a discounted price for good.",
      cta: "Become a Founding User",
    },
  },

  privacy: {
    kicker: "Privacy",
    heading: { lead: "Your data stays ", accent: "where you put it", tail: "." },
    lead: "No bank logins. Your records live on your computer. Cloud features reach beyond it, and nothing leaves until you sign in with a Nixus Cloud account.",
    layers: {
      kicker: "Three layers",
      heading: "What stays, and what can leave",
      lead: "Most of Nixus runs on your own computer, not on ours, and anything that goes further is optional.",
      items: [
        {
          badge: "Always on",
          title: "On your computer",
          lead: "Saved on your computer, not on our servers.",
          body: "Your transactions, budgets and accounts live in a file on your own computer, a bit like a document. Nothing is sent to us, so there is no account to create.",
          points: [
            "No one else holds your financial data",
            "Nothing to leak from a company database",
            "You keep it, and you can delete it any time",
          ],
        },
        {
          badge: "Opt-in · Classic",
          title: "Cloud sync",
          lead: "Protected, and only yours.",
          body: "If you turn it on, a copy of your records is kept on secure servers, in a space that belongs only to your account. Nixus does not read your records.",
          points: [
            "Encrypted while it travels and while it is stored",
            "Off until you turn it on",
            "Your AI credentials are never uploaded",
            "Deletion on request, by email",
          ],
        },
        {
          badge: "Opt-in · Advance",
          title: "AI requests",
          lead: "Only what you ask, only when you ask.",
          body: "Nothing is sent until you import a statement or ask the assistant something. Nixus does not keep it.",
          points: [
            "Your statement stays private",
            "Never used or shared by the AI service",
            "Prefer to skip our servers? Use your own AI provider",
          ],
        },
      ],
    },
    flows: {
      heading: "Exactly what leaves your computer",
      columnSituation: "Situation",
      columnSent: "What is sent",
      columnControl: "Your control",
      rows: [
        {
          situation: "On your computer",
          situationNote: "your Nixus profile",
          sent: "Nothing.",
          control: "No account, nothing to turn off.",
        },
        {
          situation: "Your bank",
          sent: "Nothing from your bank. Nixus never asks for your bank login. You import statements yourself, and when AI reads one, that statement is sent as an AI request (below).",
          control: "You choose which statements to import, and you can delete them any time.",
        },
        {
          situation: "Cloud sync",
          sent: "An encrypted copy of your records: budgets, transactions, accounts and net worth history. Kept on secure servers.",
          control:
            "Off for a local profile, which needs no account. On automatically for a Nixus Cloud profile on a plan that includes it, and you can turn it off for that profile. Turning it off stops transfers, and you can ask us by email to delete the stored copy.",
        },
        {
          situation: "Nixus Cloud account",
          sent: "Your profile: name, date of birth, income bracket, location and an optional picture. Kept on secure servers in the United States.",
          control:
            "Only with a Nixus Cloud account. A local-only profile never uploads it. Ask us by email to delete it.",
        },
        {
          situation: "AI requests",
          sent: "Only the one request you make, such as a statement or a question. It is kept private, and Nixus does not store it, only how many requests you have made.",
          control:
            "Only when you start a request. Use your own AI provider and it goes straight there, never through Nixus.",
        },
      ],
      policyNoteLead: "The full legal text is in our",
      policyNoteLink: "privacy policy",
    },
    noLogins: {
      kicker: "No bank logins",
      heading: "Why you upload statements instead",
      body: "Connecting a bank means handing over your credentials, or trusting a third party with them. Uploading a statement gives Nixus only what it needs, and keeps the rest of your banking out of it.",
    },
    openSource: {
      kicker: "Open source",
      heading: "Read the code, not just the promise",
      body: "Nixus is open source, so anyone can check what it does with your data.",
      link: "View the source on GitHub",
    },
    closing: {
      heading: "Try it with nothing leaving your computer",
      cta: "Download Nixus",
    },
  },

  foundingUsers: {
    kicker: "Founding Users",
    heading: {
      lead: "Help build Nixus. Get it first, and ",
      accent: "pay less, forever",
      tail: ".",
    },
    noteTitle: "A note from Nick",
    noteBody: "You help me, I help you. A small gift for helping make my dream come true.",
    lead: "Founding Users get early access to the platform at a discounted price for good, in exchange for honest feedback and regular conversations with me.",
    cta: "Apply to be a Founding User",
    benefits: {
      kicker: "What you get",
      heading: "Three things, for good",
      items: [
        {
          title: "Early access",
          body: "Use the platform before everyone else, including new features as they land.",
        },
        {
          title: "A discounted price, forever",
          body: "50% off every NixusCloud plan, for as long as you stay.",
        },
        {
          title: "A direct line to me",
          body: "I read every message. You talk to the person building it, not a support queue.",
        },
      ],
    },
    ask: {
      kicker: "What I ask in return",
      heading: "Honest feedback, and real conversations",
      body: "This only works if you tell me the truth about what is good, what is bad, and what could be better.",
      items: [
        "Share what works and what does not, the good and the bad",
        "Suggest improvements, big or small",
        "Talk with me regularly about how to make Nixus better, by email or a short call when it suits you",
      ],
    },
    how: {
      kicker: "How it works",
      heading: "From application to first call",
      steps: [
        { title: "Apply", body: "Tell me a bit about how you manage money today." },
        { title: "Get access", body: "I send your invitation and lock in your price." },
        { title: "Talk to me", body: "Use it, tell me what you think, and watch it change." },
      ],
    },
    apply: {
      kicker: "Apply",
      heading: "I read every application myself",
      body: "Tell me a little about you. There are no wrong answers.",
    },
    form: {
      nameLabel: "Name",
      emailLabel: "Email",
      emailPlaceholder: "you@example.com",
      todayLabel: "How do you manage your money today?",
      todayOptions: [
        "A spreadsheet",
        "A bank-connected app",
        "Pen and paper",
        "In my head",
        "Something else",
      ],
      noBrainerLabel: "What would make Nixus a no-brainer for you?",
      submit: "Apply to be a Founding User",
      privacyNote:
        "I reply personally to every application. Your answers go only to me, by email, and are used only to follow up with you.",
      sentNote:
        "Your email app should open with your answers. If it does not, write to {email}.",
      mailSubject: "Founding User application — {name}",
      mailSubjectNoName: "Founding User application",
      mailNameLabel: "Name",
      mailEmailLabel: "Email",
      mailTodayLabel: "How I manage my money today",
      mailNoBrainerLabel: "What would make Nixus a no-brainer for me:",
    },
  },

  download: {
    kicker: "Download",
    heading: { lead: "Get Nixus, ", accent: "minus the admin", tail: "." },
    lead: "Nixus runs on macOS and Windows. Nixus is free on your computer and needs no account.",
    platforms: [
      { name: "macOS", label: "Download for macOS" },
      { name: "Windows", label: "Download for Windows" },
    ],
    firstRun: {
      kicker: "After you install",
      heading: "Your first five minutes",
      items: [
        "Create your free profile on your computer. No account.",
        "Drop in a credit card statement.",
        "Check the categories, then see your overview.",
      ],
    },
    more: {
      kicker: "Want more?",
      heading: "Household views and AI",
      body: "Those come with NixusCloud, which needs an account.",
      trialNote:
        "NixusCloud Advance starts with 7 days free. A card is required, it continues as a paid monthly plan when the trial ends, and you can cancel before then at no cost.",
      plansLink: "See the plans",
      accountLink: "Log in or create an account",
    },
  },

  notFound: {
    heading: "This page went missing",
    body: "It may have moved when the site was redesigned.",
    cta: "Back to home",
  },

  legal: {
    lastUpdated: "Last updated: 24 November 2026",
    backHome: "Back to home",
    terms: TERMS_EN,
    privacyPolicy: PRIVACY_POLICY_EN,
  },
};
