---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
inputDocuments: []
date: 2026-03-14
author: dev
---

# Product Brief: nkbaz-finance

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

nkbaz-finance is a personal finance management application that replaces manual spreadsheet tracking with an automation-first approach. The app enables users to build monthly budgets with grouped categories, track expenses, manage multiple accounts, and monitor net worth across diverse asset types (cash, crypto, housing, TFSA, RRSP, etc.). Its standout feature is AI-powered expense import — users upload a screenshot or PDF of their credit card statement, and the system automatically categorizes spending into the right budget categories using Strand SDK and AWS Bedrock. Built initially for personal use and close friends/family, each user gets their own isolated account and data.

---

## Core Vision

### Problem Statement

Managing personal finances through spreadsheets is tedious and manual. Every transaction requires hand-entry, categorization, and reconciliation — work that most people eventually abandon or do inconsistently. The result is an incomplete, outdated picture of one's financial health.

### Problem Impact

Without consistent tracking, users lose visibility into where their money goes, how their budget is performing, and how their overall net worth is evolving. Financial decisions get made on gut feeling rather than data. The manual effort creates a friction barrier that prevents people from maintaining good financial habits.

### Why Existing Solutions Fall Short

While tools like spreadsheets offer full flexibility, they demand constant manual effort. The user's experience with Google Sheets reflects a common pattern: it works until the maintenance burden causes tracking to slip. The market has budgeting apps and net worth trackers, but nkbaz-finance is being built to scratch a personal itch — automation-first, with no compromises on the features that matter most to the builder and their circle.

### Proposed Solution

A web application with:
- **Monthly budget builder** with customizable category groups
- **AI-powered expense import** — upload CC screenshots/PDFs and auto-categorize via Strand SDK + AWS Bedrock
- **Multi-account tracking** — bank accounts and balances in one view
- **Passive asset tracking** — business ownership, real estate, vehicles, and other assets
- **Dashboard** — quick-glance view of budget status, balances, and key financial metrics
- **Net worth history** — historical tracking split by category (cash, crypto, housing, TFSA, RRSP, etc.)
- **Multi-user support** — individual isolated accounts for friends and family

### Key Differentiators

- **Automation-first philosophy** — the core promise is eliminating manual data entry, starting with AI-powered credit card statement parsing
- **Comprehensive financial picture** — budgeting, spending, accounts, AND assets/net worth in one place rather than scattered tools
- **Built by a user, for users** — designed from real pain points with Google Sheets, not theoretical product-market research
- **AI-native architecture** — Strand SDK + Bedrock integration from day one, not bolted on as an afterthought

## Target Users

### Primary Users

**Persona 1: "Dev" — The Power User / Builder**
- Mid-career professional managing a complex financial portfolio
- Multiple bank accounts (Wealthsimple, Desjardins, Tangerine, etc.), TFSA, RRSP, US/CAD accounts, non-registered investments, crypto, and property
- Currently tracking via Google Sheets — functional but tedious and manual
- Uses the app bi-weekly, primarily when CC statements arrive
- Wants full visibility: budgeting, expense tracking, all accounts, assets, and net worth history
- Tech-savvy — comfortable with all features

**Persona 2: "Alex" — The Casual Tracker**
- Friend or family member, 20s-30s, simpler financial picture
- Maybe a couple bank accounts, starting to invest (TFSA, some crypto)
- Not very technical — needs the app to be intuitive and obvious
- Wants to understand where their money goes and stick to a budget
- The CC screenshot upload is the killer feature — removes the friction of manual entry
- Uses it bi-weekly or monthly

**Persona 3: "Marie" — The Established Saver**
- Family member, 40s-50s, more assets but less tech comfort
- Multiple accounts, property, maybe a small business
- Needs the simplest possible experience — upload, review, done
- Values the net worth overview and seeing everything in one place
- Least tolerant of complexity or confusing UI

### Secondary Users

N/A — No admin, support, or oversight roles needed at this stage. All users are equal peers with isolated accounts.

### User Journey

1. **Discovery:** Invited directly by dev (word of mouth, friends/family)
2. **Onboarding:** Create account, set up budget categories/groups, add their accounts and assets
3. **Core Usage (bi-weekly):** Upload CC screenshot/PDF → AI auto-categorizes → review budget status → adjust if needed → glance at dashboard
4. **Success Moment:** First time they upload a CC statement and see everything categorized automatically — "I never have to type this stuff in again"
5. **Long-term:** Monthly/quarterly net worth check-ins, watching trends over time, adjusting budgets as life changes

## Success Metrics

The primary measure of success for nkbaz-finance is whether it eliminates the manual spreadsheet workflow and provides reliable, automated financial tracking.

**User Success Metrics:**
- **CC Auto-Categorization Accuracy:** 95%+ of transactions correctly categorized from uploaded screenshots/PDFs
- **Spreadsheet Replacement:** Google Sheets is no longer used for finance tracking
- **Bi-weekly Workflow Completion:** Upload CC statement → review categorized expenses → check budget status in under 5 minutes
- **Financial Visibility:** Net worth and budget status are always current and accessible in a single glance

### Business Objectives

N/A — This is a personal project built to solve a personal problem. No commercial growth, revenue, or user acquisition goals at this stage.

### Key Performance Indicators

| KPI | Target | Measurement |
|-----|--------|-------------|
| CC categorization accuracy | 95%+ | Correct categories vs. manual corrections needed |
| Budget tracking completeness | 100% of months tracked | No gaps in monthly budget data |
| Time to update finances | < 5 min per bi-weekly session | From upload to reviewed dashboard |
| Account coverage | All accounts represented | Every bank/investment/asset reflected in the app |

## MVP Scope

### Core Features

1. **Monthly Budget Builder** — Create and manage monthly budgets with customizable category groups (e.g., Housing, Food, Transport, Entertainment, etc.)
2. **AI-Powered CC Import** — Upload credit card screenshot or PDF → Strand SDK + AWS Bedrock auto-extracts transactions and categorizes them into budget categories with 95%+ accuracy
3. **Expense Tracking** — View, review, and correct auto-categorized expenses; manual entry as fallback
4. **Multi-Account Tracking** — Track balances across multiple banks and account types (Wealthsimple, Desjardins, Tangerine, TFSA, RRSP, US/CAD, non-registered, crypto)
5. **Passive Asset Tracking** — Track value of business ownership, real estate, vehicles, and other assets
6. **Dashboard** — Quick-glance view showing budget remaining, spending by category, account balances, total net worth, and key financial metrics
7. **Net Worth History** — Historical tracking of total net worth split by category (cash, crypto, housing, TFSA, RRSP, etc.)

### Out of Scope for MVP

- **User authentication / multi-user support** — MVP is a single-user app with no login. Multi-user with isolated accounts deferred to v2
- **Bank API integrations** — No automatic bank syncing; balances are manually entered or updated
- **Mobile app** — Web only for MVP
- **Shared/household budgeting** — No shared views or collaborative features
- **Notifications or alerts** — No budget threshold alerts or reminders

### MVP Success Criteria

- CC statement upload correctly categorizes 95%+ of transactions
- Full bi-weekly workflow (upload → review → dashboard) completes in under 5 minutes
- All account types and assets represented in a single view
- Net worth history accurately tracks changes over time by category
- Google Sheets fully replaced — no longer needed for finance tracking

### Future Vision

- **v2:** Multi-user authentication with isolated accounts for friends/family
- **v2+:** Bank API integrations for automatic balance syncing
- **v2+:** Mobile-responsive design or native mobile app
- **v2+:** Smart insights — AI-driven spending trends, anomaly detection, savings recommendations
- **v2+:** Recurring expense detection and prediction
- **v2+:** Export/reporting capabilities
