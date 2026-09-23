# -*- coding: utf-8 -*-
"""Generate the EDA plots for the same dataset used by model training."""

from pathlib import Path


def run_eda(data_path: Path | str = "spam.csv", output_dir: Path | str = "."):
    import matplotlib.pyplot as plt
    import seaborn as sns
    from wordcloud import WordCloud

    from spamham_project_v3 import load_data

    data_path = Path(data_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    df = load_data(data_path)[["label", "message"]]

    sns.countplot(x="label", data=df)
    plt.title("Spam vs Ham Count")
    plt.savefig(output_dir / "spam_ham_count.png")
    plt.close()

    df["length"] = df["message"].str.len()
    for label, color in (("ham", "blue"), ("spam", "red")):
        subset = df.loc[df["label"] == label, "length"]
        if not subset.empty:
            subset.plot(kind="hist", bins=50, alpha=0.5, label=label, color=color)
    plt.legend()
    plt.title("Message Length: Spam vs Ham")
    plt.savefig(output_dir / "message_length.png")
    plt.close()

    for label, filename, color in (
        ("spam", "spam_wordcloud.png", "white"),
        ("ham", "ham_wordcloud.png", "black"),
    ):
        text = " ".join(df.loc[df["label"] == label, "message"])
        if not text:
            continue
        cloud = WordCloud(width=600, height=400, background_color=color).generate(text)
        plt.figure(figsize=(8, 6))
        plt.imshow(cloud)
        plt.axis("off")
        plt.title(f"Most Common Words in {label.upper()}")
        plt.savefig(output_dir / filename)
        plt.close()


if __name__ == "__main__":
    run_eda()
