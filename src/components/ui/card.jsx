import * as React from "react"
import { cn } from "@/lib/utils"

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground", className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }) {
  return <div data-slot="card-header" className={cn("flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1", className)} {...props} />
}

function CardTitle({ className, ...props }) {
  return <h3 data-slot="card-title" className={cn("font-heading text-base font-bold leading-tight", className)} {...props} />
}

function CardDescription({ className, ...props }) {
  return <p data-slot="card-description" className={cn("text-xs text-muted-foreground", className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription }
