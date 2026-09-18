# AI Fraud Detection

Message classification pipeline (spam / ham) built as the base model for
fraudulent-message detection. Originally developed in Google Colab.

## Contents

- `spamham_project_v2.py` — data loading, cleaning and exploratory analysis:
  - loads the `spam.csv` dataset (latin-1 encoded)
  - drops duplicates and inspects the class balance
  - plots spam vs. ham counts and message-length distributions
  - generates word clouds for the most common spam and ham terms
  - normalises text (lowercasing, URL/punctuation stripping, stop-word removal)

## Setup

```bash
pip install -r requirements.txt
python -c "import nltk; nltk.download('stopwords')"
```

## Usage

The script currently reads the dataset from Google Drive:

```python
df = pd.read_csv('/content/drive/MyDrive/spam.csv', encoding='latin-1')
```

To run it locally, place `spam.csv` beside the script, drop the
`google.colab` mount lines, and point the path at `spam.csv`.

## Author

Arsh (ArshPunisher)
