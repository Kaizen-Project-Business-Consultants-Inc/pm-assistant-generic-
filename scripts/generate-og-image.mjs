import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, '../src/client/public/og-image.png');

// 1200x630 OG image — indigo gradient background, Kovarti PM branding
const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e1b4b"/>
      <stop offset="50%" style="stop-color:#312e81"/>
      <stop offset="100%" style="stop-color:#4338ca"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#818cf8"/>
      <stop offset="100%" style="stop-color:#a78bfa"/>
    </linearGradient>
    <!-- Subtle grid pattern -->
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <!-- Decorative circles -->
  <circle cx="1050" cy="100" r="200" fill="rgba(99,102,241,0.15)"/>
  <circle cx="150" cy="530" r="150" fill="rgba(139,92,246,0.1)"/>
  <circle cx="900" cy="500" r="100" fill="rgba(99,102,241,0.08)"/>

  <!-- Accent line -->
  <rect x="100" y="260" width="80" height="4" rx="2" fill="url(#accent)"/>

  <!-- Logo mark (K stylized) -->
  <g transform="translate(100, 140)">
    <rect width="48" height="48" rx="12" fill="#6366f1"/>
    <text x="14" y="35" font-family="Arial, sans-serif" font-weight="800" font-size="28" fill="white">K</text>
  </g>

  <!-- Brand name -->
  <text x="160" y="178" font-family="Arial, sans-serif" font-weight="700" font-size="24" fill="#c7d2fe" letter-spacing="1">KOVARTI PM</text>

  <!-- Main headline -->
  <text x="100" y="330" font-family="Arial, sans-serif" font-weight="800" font-size="52" fill="white">MS Project-Grade Scheduling</text>
  <text x="100" y="395" font-family="Arial, sans-serif" font-weight="800" font-size="52" fill="url(#accent)">Powered by AI</text>

  <!-- Feature pills -->
  <g transform="translate(100, 440)">
    <rect x="0" y="0" width="140" height="36" rx="18" fill="rgba(99,102,241,0.25)" stroke="rgba(129,140,248,0.4)" stroke-width="1"/>
    <text x="70" y="23" font-family="Arial, sans-serif" font-size="14" fill="#c7d2fe" text-anchor="middle">Gantt Charts</text>

    <rect x="155" y="0" width="160" height="36" rx="18" fill="rgba(99,102,241,0.25)" stroke="rgba(129,140,248,0.4)" stroke-width="1"/>
    <text x="235" y="23" font-family="Arial, sans-serif" font-size="14" fill="#c7d2fe" text-anchor="middle">EVM Forecasting</text>

    <rect x="330" y="0" width="175" height="36" rx="18" fill="rgba(99,102,241,0.25)" stroke="rgba(129,140,248,0.4)" stroke-width="1"/>
    <text x="417" y="23" font-family="Arial, sans-serif" font-size="14" fill="#c7d2fe" text-anchor="middle">Monte Carlo Sim</text>

    <rect x="520" y="0" width="155" height="36" rx="18" fill="rgba(99,102,241,0.25)" stroke="rgba(129,140,248,0.4)" stroke-width="1"/>
    <text x="597" y="23" font-family="Arial, sans-serif" font-size="14" fill="#c7d2fe" text-anchor="middle">Sprint Boards</text>

    <rect x="690" y="0" width="155" height="36" rx="18" fill="rgba(99,102,241,0.25)" stroke="rgba(129,140,248,0.4)" stroke-width="1"/>
    <text x="767" y="23" font-family="Arial, sans-serif" font-size="14" fill="#c7d2fe" text-anchor="middle">AI Agents</text>
  </g>

  <!-- Tagline -->
  <text x="100" y="540" font-family="Arial, sans-serif" font-weight="400" font-size="20" fill="rgba(199,210,254,0.7)">14-day free trial  |  No credit card required</text>

  <!-- URL -->
  <text x="1100" y="590" font-family="Arial, sans-serif" font-weight="600" font-size="18" fill="rgba(199,210,254,0.5)" text-anchor="end">kovarti.com</text>
</svg>`;

const buffer = await sharp(Buffer.from(svg)).png({ quality: 90, compressionLevel: 9 }).toBuffer();
writeFileSync(outputPath, buffer);
console.log(`OG image generated: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
