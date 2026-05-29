# Ralph Fix Plan

## Stories to Implement

### App Improvements & Refinements
> Goal: Bug fixes and UX improvements to existing features — chat URL validation, spending trends time window, dashboard month navigation, AI import merchant memory, and recurring expense templates.

- [x] Story 14.1: Chat Search Param and Missing Conversation Fix
  > As a user
  > I want the chat page to validate conversation IDs properly and show a clear error when a conversation doesn't exist
  > So that invalid URLs don't silently show a blank page or accept garbage values.
  > AC: 1) Navigating to /chat?conversation=999 (non-existent ID) shows "conversation not found" message with link to new chat — never blank. 2) validateSearch rejects negative numbers, floats, and zero — only positive integers accepted. 3) Error uses existing destructive border/bg styling. 4) No regression: valid IDs still load; empty-state still shows when no param provided.
  > Spec: specs/implementation-artifacts/14-1-chat-search-param-and-missing-conversation-fix.md
- [x] Story 14.2: Spending Trends Time Window Selector
  > As a user
  > I want to choose between 3, 6, and 12 months on the Spending Trends page
  > So that I can see shorter or longer trend windows without being locked into the hardcoded 6-month view.
  > AC: 1) PillTabs appear above chart with options: 3 months, 6 months, 12 months. 2) Default is 6 months. 3) Selecting a different window re-fetches and re-renders chart and category table immediately. 4) Selected window reflected in translated labels (Projection page pattern). 5) No backend changes needed.
  > Spec: specs/implementation-artifacts/14-2-spending-trends-time-window-selector.md
- [x] Story 14.3: Dashboard Month Navigation
  > As a user
  > I want to navigate to previous months on the Dashboard
  > So that I can review last month's budget status and spending without switching to the Budget page.
  > AC: 1) Month navigator (prev/next chevrons + label) appears on Dashboard, consistent with Budget page. 2) All dashboard data re-fetches for selected month. 3) Default is current month. 4) Future month navigation allowed. 5) No backend changes needed.
  > Spec: specs/implementation-artifacts/14-3-dashboard-month-navigation.md
- [x] Story 14.4: AI Import Merchant-Category Memory
  > As a user
  > I want the import system to remember how I categorized merchants in past imports
  > So that future imports require fewer manual corrections and accuracy improves over time.
  > AC: 1) When user corrects AI category suggestion, that merchant→category mapping is saved. 2) When user confirms a flagged transaction without changing category, mapping is saved. 3) On next import, saved merchant hints are injected into AI prompt. 4) Merchant matching is case-insensitive. 5) If hint is overridden, old hint's confidence degrades and new category is recorded. 6) No UI changes required — improvement is invisible to user.
  > Spec: specs/implementation-artifacts/14-4-ai-import-merchant-category-memory.md
- [x] Story 14.5: Recurring Expenses
  > As a user
  > I want to define recurring expense templates and apply them to a month with one click
  > So that I stop re-entering the same expenses (rent, subscriptions, gym) manually every month.
  > AC: 1) User can create a recurring expense template with: merchant, amount, budget category, day of month. 2) User can view, edit, toggle active/inactive, and delete templates. 3) "Apply Recurring" button on Budget page creates expenses for all active templates for the selected month — skipping any that already exist. 4) Applied expenses appear with source='recurring' and correct date (capped to last day of month). 5) Deleting a template does NOT delete already-applied expenses. 6) Management interface (dedicated route) exists. 7) No regression on existing expense CRUD.
  > Spec: specs/implementation-artifacts/14-5-recurring-expenses.md

## Completed

### Project Foundation & App Shell
- [x] Story 1.1: Scaffold Tauri Desktop Application
- [x] Story 1.2: Install Frontend Dependencies & Design System
- [x] Story 1.3: Set Up Rust Backend with SQLite & Error Handling
- [x] Story 1.4: Build App Shell with Sidebar Navigation & Routing

### Budget Management
- [x] Story 2.1: Create Budget with Category Groups and Targets
- [x] Story 2.2: Edit and Delete Budget Categories, Groups, and Targets
- [x] Story 2.3: View Budget Status with Progress Bars
- [x] Story 2.4: Navigate Budget by Month

### Expense Tracking
- [x] Story 3.1: Manually Add an Expense
- [x] Story 3.2: View Expenses by Month Grouped by Category
- [x] Story 3.3: Edit and Delete Expenses

### Account & Asset Management
- [x] Story 4.1: Add and View Financial Accounts
- [x] Story 4.2: Edit, Remove, and Update Account Balances
- [x] Story 4.3: Add, Edit, and View Passive Assets

### Dashboard & Net Worth
- [x] Story 5.1: Build Dashboard with Budget Status and Account Balances
- [x] Story 5.2: Dashboard Net Worth and Spending Breakdown
- [x] Story 5.3: Net Worth Snapshot Recording
- [x] Story 5.4: Net Worth History Page with Trend Chart

### AI-Powered CC Import
- [x] Story 6.1: File Upload and Validation
- [x] Story 6.2: AI Extraction and Categorization Pipeline
- [x] Story 6.3: Transaction Review and Confirmation

### AI Chat
- [x] Story 7.1: AI Chat Page with Data Queries
- [x] Story 7.2: AI Chat Write Actions with Confirmation
- [x] Story 7.3: Floating Chat Bar (Cmd+K)

### Onboarding & Polish
- [x] Story 8.1: First-Time Onboarding Wizard
- [x] Story 8.2: Database Backup and Restore
- [x] Story 8.3: Audit Logging for Financial Data Changes
- [x] Story 8.4: Accessibility Polish

### Income Source & Entry Management
- [x] Story 9.1: Income Source Management
- [x] Story 9.2: Monthly Income Entry Recording
- [x] Story 9.3: Income History View & Current Month Total

### Dashboard Cash Flow Integration
- [x] Story 10.1: Cash Flow Summary Card on Dashboard

### Onboarding Income Step
- [x] Story 11.1: Add Income Sources Step to Onboarding Wizard

### AI Income-Aware Recommendations
- [x] Story 12.1: Income-Aware AI Chat Context

### AI Credential Management
- [x] Story 13.1: Credential Storage Foundation
- [x] Story 13.2: Settings Commands Backend
- [x] Story 13.3: Settings UI

## Notes
- Follow TDD methodology (red-green-refactor)
- One story per Ralph loop iteration
- Update this file after completing each story
