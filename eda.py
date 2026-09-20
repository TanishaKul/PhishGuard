import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
from wordcloud import WordCloud

# Dataset load karo (isi tarah jaisa pehle kiya tha)
df = pd.read_csv('spam.csv', encoding='latin-1')
df = df[['v1', 'v2']]
df.columns = ['label', 'message']
df = df.drop_duplicates()

# 1. Spam vs Ham Count
sns.countplot(x='label', data=df)
plt.title('Spam vs Ham Count')
plt.savefig('spam_ham_count.png')
plt.show()

# 2. Message Length
df['length'] = df['message'].apply(len)
df[df['label']=='ham']['length'].plot(kind='hist', bins=50, alpha=0.5, label='ham', color='blue')
df[df['label']=='spam']['length'].plot(kind='hist', bins=50, alpha=0.5, label='spam', color='red')
plt.legend()
plt.title('Message Length: Spam vs Ham')
plt.savefig('message_length.png')
plt.show()

# 3. WordCloud
spam_words = ' '.join(df[df['label']=='spam']['message'])
spam_wc = WordCloud(width=600, height=400, background_color='white').generate(spam_words)
plt.figure(figsize=(8,6))
plt.imshow(spam_wc)
plt.axis('off')
plt.title('Most Common Words in SPAM')
plt.savefig('spam_wordcloud.png')
plt.show()

ham_words = ' '.join(df[df['label']=='ham']['message'])
ham_wc = WordCloud(width=600, height=400, background_color='white').generate(ham_words)
plt.figure(figsize=(8,6))
plt.imshow(ham_wc)
plt.axis('off')
plt.title('Most Common Words in HAM')
plt.savefig('ham_wordcloud.png')
plt.show()