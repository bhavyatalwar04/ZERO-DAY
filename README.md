<div align="center">

# 🔴 ZERO-DAY MARKET

### *Trade History. Master the Future.*

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-red?style=for-the-badge)](LICENSE)
[![CI](https://github.com/bhavyatalwar04/ZERO-DAY/actions/workflows/ci.yml/badge.svg)](https://github.com/bhavyatalwar04/ZERO-DAY/actions/workflows/ci.yml)

<br />

**A premium trading simulator where you relive history's most dramatic market moments.**

*What if you could trade the 2008 crash? The GameStop squeeze? The Bitcoin halving?*

[🚀 Live Demo](https://zerodaymarket.vercel.app) · [🐛 Report Bug](../../issues) · [✨ Request Feature](../../issues)

<br />

---

</div>





## ✨ Features

<table>
<tr>
<td width="50%">

### 🎯 **Historical Scenarios**
Relive iconic market days without knowing the outcome. Four are playable:
- **COV-20:** the 9 March 2020 NSE crash.
- **TAX-19:** the corporate-tax-cut rally, 20 September 2019, NSE.
- **ELEC-24:** the election-results shock, 4 June 2024, NSE.
- **GME-21:** the GameStop squeeze, 27 January 2021, NYSE.

The last three use **real daily prices** (open, high, low, close); the minute-by-minute path between them is reconstructed and labelled as such. COV-20's prices are a synthetic reconstruction. See `docs/DECISIONS.md` (ADR-009/011).

</td>
<td width="50%">

### 📊 **Real-Time Simulation**
Experience the market as it happened. Watch candles form, news break, and prices move—then make your trading decisions.

</td>
</tr>
<tr>
<td width="50%">

### 🧠 **AI-Powered Insights**
A three-stage agent pipeline watches your trades as you make them. **Monitor** (deterministic rules) spots a risky decision such as a panic sell, averaging down or revenge trading. **Research** (an LLM with tools, no chart images) gathers the market facts at that minute. **Coach** turns both into feedback whose numbers must come from those facts. Every decision is re-checked on the server and logged to an audit trail. See `docs/DECISIONS.md`.

</td>
<td width="50%">

### 🏆 **Competitive Leaderboards**
See how your decisions stack up. The leaderboard currently lives in your browser (local only).

</td>
</tr>
<tr>
<td width="50%">

### 💰 **Zero Real Risk**
Practice with simulated capital. Make bold moves and learn from mistakes—without losing a single dollar.

</td>
<td width="50%">

### 📈 **Performance Analytics**
Track your progress over time with detailed statistics, win rates, and personalized improvement suggestions.

</td>
</tr>
</table>

<br />

## 🛠️ Tech Stack

<div align="center">

| Category | Technology |
|:--------:|:----------:|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v4 |
| **Animations** | Framer Motion |
| **Authentication** | Supabase Auth |
| **Database** | Supabase (PostgreSQL) |
| **Icons** | Lucide React |
| **Fonts** | Anton, System UI |

</div>

<br />

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **npm** or **pnpm**
- **Supabase** account (free tier works)

### Installation

```bash
# Clone the repository
git clone https://github.com/bhavyatalwar04/ZERO-DAY.git

# Navigate to project
cd ZERO-DAY

# Install dependencies
cd frontend && npm install

# Set up environment variables
cp .env.example .env.local
```

### Environment Variables

Create a `.env.local` file in the `frontend` directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Groq API Configuration (supports rotation on rate limits)
GROQ_API_KEY_1=your_groq_api_key_1
GROQ_API_KEY_2=your_groq_api_key_2 # Optional fallback
GROQ_API_KEY_3=your_groq_api_key_3 # Optional fallback
GROQ_API_KEY_4=your_groq_api_key_4 # Optional fallback
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the magic ✨

<br />

## 📁 Project Structure

```
ZERO-DAY/
├── 📂 frontend/
│   ├── 📂 app/
│   │   ├── 📄 page.tsx                  # Cinematic splash page (landing)
│   │   ├── 📂 signup/                   # Supabase Auth signup
│   │   ├── 📂 login/                    # Supabase Auth login
│   │   ├── 📂 welcome/                  # Post-signup onboarding welcome
│   │   ├── 📂 onboarding/               # Knowledge level assessment
│   │   ├── 📂 ledger/                   # Scenario library & book-style index
│   │   ├── 📂 academy/                  # Learning center & mini-game playlist
│   │   │   └── 📂 [slug]/               # Dynamic mini-game engine room
│   │   ├── 📂 sim/[id]/
│   │   │   ├── 📂 prep/                 # Pre-trade briefing & allocation desk
│   │   │   ├── 📂 live/                 # Real-time trading simulation engine
│   │   │   └── 📂 debrief/              # Post-trade AI grader & performance review
│   │   └── 📂 api/                      # Groq AI backend endpoints
│   │       ├── 📂 copilot/              # Streaming quant tutor
│   │       ├── 📂 feedback/             # Post-trade grader
│   │       ├── 📂 tutor/                # Prep room ORUS assistant
│   │       ├── 📂 debrief/              # Behavioral debrief parser
│   │       └── 📂 chat/                 # Help chat assistant
│   ├── 📂 components/                   # UI primitives & page modules
│   │   ├── 📂 ui/                       # Glassmorphic primitives (buttons, cards, etc.)
│   │   ├── 📂 prep/                     # Briefing tools & stock card grids
│   │   ├── 📂 live/                     # Real-time chart & order entry docks
│   │   ├── 📂 academy/                  # Custom games (Candle Memory, Plan Drag-n-drop)
│   │   ├── 📂 help-chat/                # Floating Orus helper chat widget
│   │   └── 📂 ledger/                   # Book-style catalog UI
│   ├── 📂 lib/
│   │   ├── 📂 behavior/                 # Cognitive bias tracer & archetype detector
│   │   ├── 📂 rl/                       # Multi-armed bandit recommender & simulation engine
│   │   ├── 📂 contexts/                 # Global state (live session engine, users, etc.)
│   │   └── 📂 hooks/                    # usePortfolioGame custom hook
│   └── 📄 package.json
├── 📂 .github/workflows/
│   └── 📄 ci.yml                        # CI/CD integration pipeline (Linters + Build)
├── 📂 ai/                               # Python research & AI model prototypes
│   ├── 📄 behavioral_analysis.py        # Cognitive bias parser
│   ├── 📄 dspy_groq_agent.py            # DSPy structured pipelines
│   ├── 📄 experimental_ai_models.py     # LLM configurations
│   ├── 📄 sentiment_analysis.py         # News headline scorer
│   ├── 📄 vlm_finetuned_agent.py        # Chart reading vision-language model
│   └── 📄 rl_dspy_learner.py            # RL agent training logic
├── 📄 .gitignore
└── 📄 README.md
```

<br />

## 🎨 Design Philosophy

<div align="center">

| Principle | Implementation |
|:---------:|:---------------|
| **🌑 Dark Mode First** | Pure black backgrounds (#000) with subtle ambient glows |
| **⚡ Performance** | Optimized video backgrounds, lazy loading, minimal JS bundle |
| **🎬 Cinematic** | Full-screen video backgrounds, dramatic typography |
| **✨ Premium Feel** | Glassmorphism, subtle animations, professional spacing |
| **📱 Responsive** | Mobile-first design with adaptive layouts |

</div>

<br />

## 🎯 Roadmap

- [x] 🎬 Cinematic splash page with video background
- [x] 📝 Premium signup/login pages
- [x] 🏠 Scenario Library & Dossier Workbench
- [x] 📊 Live trading simulation engine (deterministic tick-loop)
- [x] 🧠 ORUS AI Coaching & Feedback System
- [x] 🏆 Global Leaderboard & Social Ticker (Local Sync)
- [x] 📈 Performance Analytics & Telemetry Debrief
- [x] 🎓 Trading Academy & 10+ Mini-Games
- [x] 🤖 RL-based Content Recommender & Behavioral Tracer
- [x] 🧩 V2: Monitor → Research → Coach agent pipeline, live in the simulator
- [x] 🗄️ V2: Supabase session log, decision-audit trail, row-level security, Google sign-in
- [x] 📚 V2: 3 more scenarios on real daily data · evaluation set (pipeline vs single prompt) · scoring, baselines & progression dashboard
- [ ] 🔬 V2: the cross-session study (`docs/STUDY.md`)

<br />

## 👥 Team

Built by a 2-person team:

- **Bhavya Talwar** — Scenario data engine (deterministic OHLCV generation via mulberry32 PRNG), Live Trading Engine (state machine, order matching for MARKET/LIMIT/SL/SL-M), ORUS AI coaching system (Groq API integration, 4-key rotation fallback)
- **Pranav Singh Puri** — Multi-screen UX design, AI benchmark evaluation (FinVQA-Chart across 15 Vision-Language Models)

<br />

## 🤝 Contributing

Contributions are what make the open source community amazing! Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<br />

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

<br />

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - The React Framework
- [Tailwind CSS](https://tailwindcss.com/) - For utility-first styling
- [Framer Motion](https://www.framer.com/motion/) - For smooth animations
- [Supabase](https://supabase.com/) - For backend & authentication
- [Lucide](https://lucide.dev/) - For beautiful icons

<br />

---

<div align="center">

**Built with 🔥 by passionate traders, for traders.**

⭐ Star this repo if you find it useful!

<br />

[![GitHub stars](https://img.shields.io/github/stars/bhavyatalwar04/ZERO-DAY?style=social)](../../stargazers)
[![GitHub forks](https://img.shields.io/github/forks/bhavyatalwar04/ZERO-DAY?style=social)](../../network/members)

</div>
