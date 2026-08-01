using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface IEmailService
{
    Task SendPasswordResetEmailAsync(string toEmail, string toName, string resetLink);

    /// <summary>
    /// Generic, template-agnostic send — the single choke point every email call site
    /// (invitation, loan approval/rejection/disbursement, EMI reminders, document
    /// requests, stage-change notices, etc.) now routes through. Config (provider,
    /// credentials, from-address) is resolved server-side from the DB-backed
    /// IEmailConfigStore, so the browser never needs to hold SMTP/Brevo secrets.
    /// </summary>
    Task SendAsync(string toEmail, string toName, string subject, string htmlBody, string? cc = null, string? replyTo = null);

    /// <summary>
    /// Sends a one-off test email using the currently-saved configuration and
    /// returns a real success/failure + human-readable error, so Settings → Mail &
    /// Email can verify delivery without relying on the "always succeeds" semantics
    /// of the self-service forgot-password flow.
    /// </summary>
    Task<(bool Success, string? Error)> SendTestEmailAsync(string toEmail);
}
