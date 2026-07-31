import AuthGate from "../components/AuthGate";
import TacticalShell from "../components/TacticalShell";

export const metadata = {
  title: "AeroLeadAI Property Intelligence",
  description: "CEO Agent property intelligence console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, background: "#03050a" }}>
        <AuthGate>
          <TacticalShell>{children}</TacticalShell>
        </AuthGate>
      </body>
    </html>
  );
}
