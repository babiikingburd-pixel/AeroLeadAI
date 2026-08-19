import ClientSafetyNet from "./ClientSafetyNet";
import SwarmHeartbeat from "./SwarmHeartbeat";

export default function TwinCitiesLayout({ children }) {
  return (
    <>
      <ClientSafetyNet />
      <SwarmHeartbeat />
      {children}
    </>
  );
}
