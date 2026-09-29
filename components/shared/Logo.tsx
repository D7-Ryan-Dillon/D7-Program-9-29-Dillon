export default function Logo({ className = "h-9 w-9" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- vanilla <img>, matching the rest of the app's no-extra-deps approach
  return <img src="/fausoa-logo.png" alt="FAUSOA" className={`${className} object-contain`} />;
}
