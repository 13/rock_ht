"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open && (
            <>
              <Dialog.Overlay asChild>
                <motion.div
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              </Dialog.Overlay>

              {/*
               * Dialog.Content is the full-screen centering container.
               * pointer-events-none lets backdrop clicks reach the Overlay so
               * clicking outside still closes the dialog.
               */}
              <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none [pointer-events:none]">
                <motion.div
                  className={cn(
                    "w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl",
                    "flex flex-col max-h-full [pointer-events:auto]",
                    className
                  )}
                  initial={{ opacity: 0, scale: 0.95, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  {(title || description) && (
                    <div className="flex items-start justify-between p-5 pb-0 shrink-0">
                      <div>
                        {title && (
                          <Dialog.Title className="text-lg font-semibold text-foreground">
                            {title}
                          </Dialog.Title>
                        )}
                        {description && (
                          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                            {description}
                          </Dialog.Description>
                        )}
                      </div>
                      <Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <X className="h-4 w-4" />
                      </Dialog.Close>
                    </div>
                  )}
                  {/* min-h-0 is required: flex children default to min-height:auto
                      which prevents overflow-y-auto from activating */}
                  <div className="p-5 overflow-y-auto min-h-0 flex-1">
                    {children}
                  </div>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
