export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Quadtwo</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          fontFamily: '"Vazirmatn", "Segoe UI", Tahoma, sans-serif',
          background:
            "radial-gradient(1200px 600px at 10% -10%, #1a3a4a 0%, transparent 55%), radial-gradient(900px 500px at 100% 0%, #0f2a22 0%, transparent 50%), #0b1214",
          color: "#e8f0f2",
        }}
      >
        {children}
      </body>
    </html>
  );
}
