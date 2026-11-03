import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Thuê freelancer",
  description: "Tìm và thuê freelancer, thanh toán qua escrow USDC.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="flex gap-4 border-b px-6 py-3 text-sm">
          <Link href="/search">Tìm kiếm</Link>
          <Link href="/jobs">Công việc</Link>
          <Link href="/wallet">Ví</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
