"use client";

import {
  BookOpenIcon,
  BotIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ClapperboardIcon,
  FilmIcon,
  GalleryVerticalEndIcon,
  HistoryIcon,
  PlusIcon,
  Settings2Icon,
  StarIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionHistoryEntry } from "@/lib/takes";
import { productTheme } from "@/lib/theme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type Props = {
  sessionId: string | null;
  sessionHistory: SessionHistoryEntry[];
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenEditor: () => void;
  disabled?: boolean;
};

export function AppSidebar({
  sessionId,
  sessionHistory,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onOpenEditor,
  disabled,
}: Props) {
  const pathname = usePathname();
  const onDirector = pathname === "/";
  const onEditor = pathname.startsWith("/editor");
  const sharedSessionHref = sessionId
    ? `/?session=${encodeURIComponent(sessionId)}`
    : "/";
  const sharedEditorHref = sessionId
    ? `/editor?session=${encodeURIComponent(sessionId)}`
    : "/editor";

  return (
    <Sidebar collapsible="offcanvas" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <GalleryVerticalEndIcon className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {productTheme.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      Tutor workspace
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Workspace
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={disabled}
                  onClick={onNewSession}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                    <PlusIcon className="size-3.5" />
                  </div>
                  New session
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 p-2" asChild>
                  <Link href={sharedSessionHref}>
                    <ClapperboardIcon className="size-4" />
                    Tutor
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 p-2"
                  disabled={disabled}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenEditor();
                  }}
                >
                  <FilmIcon className="size-4" />
                  Sequence editor
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible asChild defaultOpen className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="Playground" isActive={onDirector}>
                    <TerminalIcon />
                    <span>Playground</span>
                    <ChevronRightIcon className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild isActive={onDirector}>
                        <Link href={sharedSessionHref}>
                          <ClapperboardIcon />
                          <span>Tutor</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild isActive={onEditor}>
                        <Link
                          href={sharedEditorHref}
                          onClick={(e) => {
                            if (!sessionId) {
                              e.preventDefault();
                              onOpenEditor();
                            }
                          }}
                        >
                          <FilmIcon />
                          <span>Sequence</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        aria-disabled={disabled || undefined}
                        onClick={() => {
                          if (disabled) return;
                          onNewSession();
                        }}
                      >
                        <PlusIcon />
                        <span>New session</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>

            <Collapsible asChild defaultOpen className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="History">
                    <HistoryIcon />
                    <span>History</span>
                    <ChevronRightIcon className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {sessionHistory.length === 0 ? (
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton className="text-muted-foreground">
                          <span>No sessions yet</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ) : (
                      sessionHistory.map((entry) => (
                        <SidebarMenuSubItem key={entry.id}>
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <SidebarMenuSubButton
                                isActive={entry.id === sessionId}
                                aria-disabled={disabled || undefined}
                                onClick={() => {
                                  if (disabled) return;
                                  onSwitchSession(entry.id);
                                }}
                                title={`${entry.id} · right-click to delete`}
                              >
                                <StarIcon />
                                <span>
                                  {entry.id.slice(0, 8)}…
                                  {entry.id === sessionId ? " · current" : ""}
                                </span>
                              </SidebarMenuSubButton>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-56">
                              <ContextMenuLabel>Session actions</ContextMenuLabel>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onSelect={() => onSwitchSession(entry.id)}
                              >
                                <ClapperboardIcon />
                                Open in Tutor
                              </ContextMenuItem>
                              <ContextMenuItem
                                onSelect={() => {
                                  window.location.href = `/editor?session=${encodeURIComponent(entry.id)}`;
                                }}
                              >
                                <FilmIcon />
                                Open in Sequence
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                variant="destructive"
                                disabled={disabled}
                                onSelect={() => onDeleteSession(entry.id)}
                              >
                                <Trash2Icon />
                                Delete permanently
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        </SidebarMenuSubItem>
                      ))
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>

            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Models">
                <BotIcon />
                <span>Models</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Documentation" asChild>
                <a
                  href="https://ai.google.dev/gemini-api/docs/omni"
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpenIcon />
                  <span>Documentation</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings">
                <Settings2Icon />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar size="sm" className="rounded-lg">
                    <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                      MD
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Tutor</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {sessionId
                        ? `Session ${sessionId.slice(0, 8)}…`
                        : "local session"}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar size="sm" className="rounded-lg">
                      <AvatarFallback className="rounded-lg">MD</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">Tutor</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {sessionId
                          ? `Session ${sessionId.slice(0, 8)}…`
                          : "No session"}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
