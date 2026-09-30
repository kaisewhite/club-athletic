// shadcn/ui NavigationMenu, trimmed to the parts this app uses.
//
// Added 2026-09-28 to replace the narrow layout's pill chips (owner: "these
// bubbles are super ugly"). Our nav is a flat list of ten links, so the dropdown
// half of the component — Trigger, Content, Viewport, Indicator and the
// `navigationMenuTriggerStyle` cva — is deleted rather than carried dead. That
// also drops the generated file's `lucide-react` import, which existed only for
// the Trigger's chevron: adding an icon dependency to render no icon would have
// been the wrong trade. shadcn components are owned source, meant to be edited.
//
// Re-running `shadcn add navigation-menu` would restore the dropdown parts.
import * as React from "react"
import { NavigationMenu as NavigationMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function NavigationMenu({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root>) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      data-viewport={false}
      className={cn(
        "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
        className
      )}
      {...props}
    >
      {children}
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn(
        "group flex flex-1 list-none items-center justify-center gap-1",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

function NavigationMenuLink({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        "flex flex-col gap-1 rounded-sm p-2 text-sm transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
        className
      )}
      {...props}
    />
  )
}

export { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink }
