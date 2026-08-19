import ClientSafetyNet from "./ClientSafetyNet";
import SwarmHeartbeat from "./SwarmHeartbeat";
import SystemStatusBar from "./SystemStatusBar";

export default function TwinCitiesLayout({ children }) {
  return (
    <>
      <ClientSafetyNet />
      <SystemStatusBar />
      <SwarmHeartbeat />
      {children}
    </>
  );
}
