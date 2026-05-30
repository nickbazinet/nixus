# Guidelines

Always refer to the following guidelines when it applies to the relevant context:

- Compilation (warnings.md)[docs/guidelines/warnings.md]

## BMAD-METHOD Integration

Use `/bmad-help` to discover all commands. See `_bmad/COMMANDS.md` for a full command reference.

Planning and implementation artifacts live in `_bmad-output/planning-artifacts/` and `_bmad-output/implementation-artifacts/`. Project context and implementation rules are in `docs/project-context.md`.

### Phases

| Phase | Focus | Key Commands |
|-------|-------|-------------|
| 1. Analysis | Understand the problem | `/create-brief`, `/brainstorm-project`, `/market-research` |
| 2. Planning | Define the solution | `/create-prd`, `/create-ux` |
| 3. Solutioning | Design the architecture | `/create-architecture`, `/create-epics-stories`, `/implementation-readiness` |
| 4. Implementation | Build it | `/sprint-planning`, `/create-story`, `/dev-story` |

### Workflow

1. Work through Phases 1-3 using BMAD agents and workflows (interactive, command-driven)
2. Use Phase 4 commands to implement stories from `_bmad-output/implementation-artifacts/`

### Available Agents

| Command | Agent | Role |
|---------|-------|------|
| `/analyst` | Analyst | Research, briefs, discovery |
| `/architect` | Architect | Technical design, architecture |
| `/pm` | Product Manager | PRDs, epics, stories |
| `/sm` | Scrum Master | Sprint planning, status, coordination |
| `/dev` | Developer | Implementation, coding |
| `/ux-designer` | UX Designer | User experience, wireframes |
| `/qa` | QA Engineer | Test automation, quality assurance |
