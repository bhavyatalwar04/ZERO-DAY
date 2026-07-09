# 🤖 AI Research & Model Prototypes

This directory contains standalone Python prototypes, fine-tuning configurations, and agentic reinforcement learning scripts. These files serve as a research sandbox to test model architectures, DSPy prompts, and custom pipelines before productionizing them.

---

## 📁 File Registry

| File Name | Purpose & Description | Key Technologies |
|:---|:---|:---|
| **`behavioral_analysis_implementation.py`** | Converts user session data (hold times, trade counts, risk tolerance) into prompts and trains a base LLaMA model from scratch to classify user risk profiles. | PyTorch, `transformers` (LLaMA config), Causal LLM classification |
| **`dspy_groq_implementation.py`** | Sets up a structured pipeline using the DSPy framework to perform financial reasoning and create action plans using Groq's LLaMA 3 70B model. | DSPy, Groq API, Chain-of-Thought reasoning |
| **`experimental_ai_models.py`** | A consolidated experimental wrapper combining DSPy, fine-tuned Vision-Language Models (VLM), custom sentiment analysis, and XGBoost-based behavioral classification. | DSPy, HuggingFace pipeline, XGBoost, Pillow |
| **`sentiment_analysis_implementation.py`** | Fine-tunes a base LLaMA sequence classifier using Parameter-Efficient Fine-Tuning (PEFT) and LoRA adapters to grade headline sentiments. | PyTorch, HuggingFace PEFT, LoRA, sequence classification |
| **`vlm_finetuned_implementation.py`** | Synthesizes a Vision-Language Model from scratch by projecting CLIP visual patch embeddings into a base LLaMA's language embedding space. | PyTorch, `transformers` (CLIP + LLaMA config), multi-modal projection |
| **`rl_dspy_learner.py`** | An online reinforcement learning agent using a Linear Upper Confidence Bound (LinUCB) contextual bandit that updates weights based on user choice rewards, with a DSPy optimization layer. | NumPy, SQLite, LinUCB Bandit, DSPy BootstrapFewShot |

---

## 🚀 Execution & Sandbox Testing

To run these experimental scripts locally:

1. **Install python dependencies**:
   ```bash
   pip install torch transformers peft datasets dspy-ai numpy xgboost joblib pillow
   ```

2. **Configure API Keys** (for DSPy/Groq scripts):
   ```bash
   $env:GROQ_API_KEY="your-groq-key"  # PowerShell
   # or
   export GROQ_API_KEY="your-groq-key"  # Bash
   ```

3. **Run a script**:
   ```bash
   python ai/dspy_groq_implementation.py
   ```

> [!NOTE]
> These models are standalone experiments. The live application implements a production-ready serverless TypeScript-based Groq API client with dynamic key rotation located under `frontend/lib/ai/` and `frontend/app/api/`.
