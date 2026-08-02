import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

type SortDirection = "ascending" | "descending" | "none"

// Real <table> markup. The shipped ExpenseList renders a <div> of flex rows, which is why nothing in
// it can sort and why a screen reader gets no row/column relationships at all.
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full border-collapse text-label text-ink",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-line text-ink-dim [&_td]:border-b-0 [&_th]:border-b-0",
        className
      )}
      {...props}
    />
  )
}

interface TableRowProps extends React.ComponentProps<"tr"> {
  selected?: boolean
  /**
   * Click and `Enter` must open the same thing. Providing only one of them is the difference
   * between a row a mouse user can open and a row a keyboard user cannot.
   */
  onActivate?: () => void
}

function TableRow({
  className,
  selected = false,
  onActivate,
  onClick,
  onKeyDown,
  ...props
}: TableRowProps) {
  return (
    <tr
      data-slot="table-row"
      data-selected={selected || undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-selected={selected || undefined}
      onClick={(event) => {
        onClick?.(event)
        onActivate?.()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (onActivate && event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault()
          onActivate()
        }
      }}
      className={cn(
        "border-b border-line hover:bg-hover data-selected:bg-brand-soft",
        onActivate && cn("cursor-pointer", focusRing),
        className
      )}
      {...props}
    />
  )
}

interface TableHeadProps extends Omit<React.ComponentProps<"th">, "aria-sort"> {
  numeric?: boolean
  sortable?: boolean
  sortDirection?: SortDirection
  onSort?: () => void
}

// Column heads are 13px sentence case, NOT 12px uppercase. Uppercase stacks three legibility
// penalties — small size, lost letter shapes, rapid-scan usage — on the content the primary user
// scans most often. The .working mocks render these uppercase; the spine wins on conflict.
//
// `aria-sort` is mandatory on a sortable head: the arrow glyph alone leaves a screen reader user
// unable to tell which column is sorted or in which direction.
function TableHead({
  className,
  children,
  numeric = false,
  sortable = false,
  sortDirection = "none",
  onSort,
  ...props
}: TableHeadProps) {
  const SortIcon =
    sortDirection === "ascending"
      ? ArrowUpIcon
      : sortDirection === "descending"
        ? ArrowDownIcon
        : ArrowUpDownIcon

  return (
    <th
      data-slot="table-head"
      scope="col"
      aria-sort={sortable ? sortDirection : undefined}
      className={cn(
        "border-b border-line px-3 py-2.5 text-left text-column-head whitespace-nowrap text-ink-faint",
        numeric && "text-right",
        className
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "inline-flex min-h-target-min items-center gap-1 rounded-sm text-column-head transition-colors hover:text-ink",
            numeric && "flex-row-reverse",
            sortDirection !== "none" && "text-brand-ink",
            focusRing
          )}
        >
          {children}
          <SortIcon className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

interface TableCellProps extends React.ComponentProps<"td"> {
  /** Right-aligned and tabular. Every figure in a column has to line up to be comparable. */
  numeric?: boolean
  dim?: boolean
}

function TableCell({
  className,
  numeric = false,
  dim = false,
  ...props
}: TableCellProps) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "border-b border-line px-3 py-2.5 align-middle",
        numeric && "money text-right font-semibold",
        dim && "text-ink-dim",
        className
      )}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
}
export type { TableRowProps, TableHeadProps, TableCellProps, SortDirection }
