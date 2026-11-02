# Nixus Social Post System

## 1. Atmosphere & Identity
Warm, quiet financial clarity. Each post turns an intimidating money task into a composed, legible moment; the signature is a small piece of real product UI set against a soft ivory field with a restrained violet action colour.

## 2. Color
| Token | Value | Usage |
|---|---|---|
| `--paper` | `#FAF8F5` | Primary canvas |
| `--card` | `#FFFFFF` | Product and content surfaces |
| `--ink` | `#1C1917` | Headlines |
| `--muted` | `#6B635A` | Supporting copy |
| `--line` | `#E8E3DA` | Hairlines |
| `--brand` | `#5B54D6` | CTA and key data |
| `--brand-soft` | `#EFEDFB` | Feature callouts |

## 3. Typography
Inter, system-ui, sans-serif. Display uses 76px/700/-0.04em; body uses 28px/400/1.35; labels use 18px/700/0.12em.

## 4. Spacing & Layout
The 1080 × 1350 canvas uses a 72px outer inset and an 8px base unit. Copy is left-aligned with one focal product or data card in the lower half.

## 5. Components
### Brand header
- **Structure:** logo + category label
- **States:** static asset
- **Accessibility:** descriptive logo alt text

### Insight card
- **Structure:** label, key metric, supporting line
- **Variants:** light, violet, dark
- **Accessibility:** 4.5:1 minimum text contrast

### Product frame
- **Structure:** mock interface or product screenshot
- **Variants:** statement, dashboard, chat, garage
- **Accessibility:** all text remains selectable HTML

## 6. Motion & Interaction
Static export assets; no motion is used. Each document is optimized for browser capture at 1080 × 1350.

## 7. Depth & Surface
Mixed: one restrained warm product-frame shadow plus `--line` hairlines. Ordinary text surfaces remain flat.

## 8. Accessibility Constraints & Accepted Debt
WCAG 2.2 AA contrast target. Semantic heading and image alternative text are included. No accepted debt.
