import V22MaxConsole from "../components/v22max/V22MaxConsole";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <V22MaxConsole limit={500} />;
}
