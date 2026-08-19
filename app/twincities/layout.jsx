import SwarmHeartbeat from "./SwarmHeartbeat";

export default function TwinCitiesLayout({ children }) {
  return (
    <>
      <SwarmHeartbeat />
      {children}
    </>
  );
}
