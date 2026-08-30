// ---------------------------------------------------------------------------
// Atlas Command Palette
//
// A Cmd+K / Ctrl+K command surface that provides universal navigation and
// action access from anywhere in Atlas. Uses the existing shadcn Dialog
// component for the overlay, and the command system from atlas-experience.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import {
  BUILTIN_COMMANDS,
  searchCommands,
  groupCommands,
  type AtlasCommand,
} from "@/lib/atlas-experience/commands";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Search,
  ArrowRight,
  CornerDownLeft,
  Command,
} from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { entity } = useAtlasContext();

  // Filter commands by role (simplified — no full RBAC check here)
  const commands = BUILTIN_COMMANDS;
  const results = searchCommands(commands, query);
  const groups = groupCommands(results);
  const flatResults = results;

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeCommand = useCallback(
    (cmd: AtlasCommand) => {
      setOpen(false);
      if (cmd.href) {
        navigate(cmd.href);
      } else if (cmd.action) {
        cmd.action();
      }
    },
    [navigate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (flatResults[selectedIndex]) {
          executeCommand(flatResults[selectedIndex]);
        }
      }
    },
    [flatResults, selectedIndex, executeCommand],
  );

  // Context-aware placeholder
  const placeholder = (() => {
    if (entity?.type === "claim") return "Ask about this claim…";
    if (entity?.type === "knowledge") return "Ask about this document…";
    if (entity?.type === "recommendation") return "Ask about this recommendation…";
    if (entity?.type === "company") return "Ask about this company…";
    return "Search commands, navigate, or ask Atlas…";
  })();

  return (
    <>
      {/* Trigger button — visible in the header */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-300"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-1 hidden rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 sm:inline">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <kbd className="flex items-center gap-0.5 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {flatResults.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Search className="size-6 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No results for "{query}"</p>
                <p className="text-xs text-muted-foreground/70">
                  Try different keywords or use arrow keys to browse
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.category} className="mb-2">
                  <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    {group.label}
                  </p>
                  {group.commands.map((cmd) => {
                    const globalIndex = flatResults.indexOf(cmd);
                    const isSelected = globalIndex === selectedIndex;
                    const Icon = cmd.icon;

                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onClick={() => executeCommand(cmd)}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                          isSelected
                            ? "bg-teal-400/10 text-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg",
                            isSelected
                              ? "bg-teal-400/15 text-teal-600 dark:text-teal-300"
                              : "bg-muted/50 text-muted-foreground",
                          )}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{cmd.label}</p>
                          {cmd.description && (
                            <p className="truncate text-[11px] text-muted-foreground/70">
                              {cmd.description}
                            </p>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <kbd className="hidden rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 sm:inline">
                            {cmd.shortcut}
                          </kbd>
                        )}
                        {isSelected && cmd.href && (
                          <ArrowRight className="size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hints */}
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2">
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" /> select
              </span>
              <span className="flex items-center gap-1">
                ↑↓ navigate
              </span>
            </div>
            {entity && (
              <span className="rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-600 dark:text-teal-300">
                Context: {entity.type}
              </span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
