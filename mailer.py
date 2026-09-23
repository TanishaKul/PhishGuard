# -*- coding: utf-8 -*-
"""
Outgoing email. With SMTP_HOST set, mail goes through that server;
otherwise it is printed to the API console in development. Production
(APP_ENV=production) fails closed without SMTP.

  SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, MAIL_FROM
"""

import os
import smtplib
from email.message import EmailMessage


class MailError(Exception):
    pass


class ConsoleMailer:
    def send(self, to: str, subject: str, body: str):
        print(f"\n[PhishGuard mail] To: {to}\nSubject: {subject}\n\n{body}\n", flush=True)


class DisabledMailer:
    """Fail closed when production is accidentally configured without SMTP."""

    def send(self, to: str, subject: str, body: str):
        raise MailError("SMTP must be configured when APP_ENV=production")


class SmtpMailer:
    def __init__(self, host: str, port: int, user: str | None, password: str | None, sender: str):
        self.host, self.port, self.user, self.password, self.sender = host, port, user, password, sender

    def send(self, to: str, subject: str, body: str):
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=15) as smtp:
                smtp.starttls()
                if self.user:
                    smtp.login(self.user, self.password or "")
                smtp.send_message(msg)
        except (OSError, smtplib.SMTPException) as exc:
            raise MailError(f"SMTP send to {self.host}:{self.port} failed: {exc}") from exc


def mailer_from_env():
    host = os.environ.get("SMTP_HOST")
    if not host:
        if os.environ.get("APP_ENV", "development").lower() == "production":
            return DisabledMailer()
        return ConsoleMailer()
    return SmtpMailer(host, int(os.environ.get("SMTP_PORT", "587")), os.environ.get("SMTP_USER"),
                      os.environ.get("SMTP_PASSWORD"), os.environ.get("MAIL_FROM", "no-reply@phishguard.local"))
