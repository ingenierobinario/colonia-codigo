import { AgentAvatar, type ColoniaLook, type ColoniaMode, ColoniaProvider, Button, Message, Tag } from "@colonia/ui";

function Sample({ look, mode }: { look: ColoniaLook; mode: ColoniaMode }) {
  return (
    <ColoniaProvider look={look} mode={mode} fill style={{ padding: 14, borderRadius: 12, width: 300 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <AgentAvatar name="Roby" blob="noche" size={24} animated={false} />
        <strong style={{ fontWeight: 500 }}>Roby</strong>
        <Tag kind="role">Super-agente</Tag>
      </div>
      <Message>Ready when you are.</Message>
      <Message from="user">Ship it.</Message>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <Button size="sm">Approve</Button>
        <Button size="sm" variant="secondary">
          Later
        </Button>
      </div>
    </ColoniaProvider>
  );
}

export function LooksAndModes() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 300px", gap: 12 }}>
      <Sample look="minimal" mode="light" />
      <Sample look="minimal" mode="dark" />
      <Sample look="classic" mode="light" />
      <Sample look="classic" mode="dark" />
    </div>
  );
}
