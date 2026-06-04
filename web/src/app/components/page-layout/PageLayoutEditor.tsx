import { useState, type ReactNode } from "react";
import { LayoutPanelLeft } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { useCanManageTenantSettings } from "../../lib/roles";

type PageLayoutEditorProps = {
  title: string;
  buttonLabel?: string;
  description?: string;
  children: ReactNode;
};

export function PageLayoutEditor({
  title,
  buttonLabel = "Page layout",
  description,
  children,
}: PageLayoutEditorProps) {
  const canEdit = useCanManageTenantSettings();
  const [open, setOpen] = useState(false);

  if (!canEdit) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={buttonLabel}
      >
        <LayoutPanelLeft className="w-4 h-4" />
        {buttonLabel}
      </Button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={title}
        size="xl"
        footer={
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-4">
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
          {children}
        </div>
      </Modal>
    </>
  );
}
