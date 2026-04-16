import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import ChatPanel from "@/components/ChatPanel";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FOIA Fluent",
  description: "Search existing FOIA requests and public records",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="app-shell">
          <Sidebar />
          <main className="app-main">
            {children}
            <Footer />
          </main>
        </div>
        <ChatPanel />
        <Analytics />
      </body>
    </html>
  );
}
