import UnifiedCommand from "../components/v22max/UnifiedCommand";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <UnifiedCommand limit={500} />;
}
