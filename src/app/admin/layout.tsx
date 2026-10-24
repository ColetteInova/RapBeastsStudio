import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RapBeasts Studio — Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <div className="admin-bar">
        <span className="admin-bar-badge">ADMIN</span>
        <span className="admin-bar-text">
          Área de administração — disponível apenas em localhost.
        </span>
      </div>
      {children}
    </>
  );
}
