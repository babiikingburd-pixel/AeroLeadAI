import AuthGate from "../components/AuthGate";
import ConditionalTopNav from "../components/ConditionalTopNav";

export const metadata = {
  title: "AeroLeadAI Property Intelligence",
  description: "CEO Agent property intelligence console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0f16" }}>
        <AuthGate>
          <ConditionalTopNav />
          {children}
        </AuthGate>
      </body>
    </html>
  );
}
