using Amazon.S3;
using Amazon.S3.Model;
using LoanMS.Application.Interfaces;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Persists document bytes to Amazon S3 instead of the ECS Fargate
/// container's local disk — see IFileStorageService's doc comment for why
/// local disk is unsafe on this deployment topology (ephemeral, and
/// invisible across the multiple tasks a service can be running).
///
/// Credentials are NOT read from configuration/environment variables here —
/// AmazonS3Client() with no explicit credentials picks up the ECS task's
/// attached IAM role automatically (the standard, recommended way to
/// authenticate from within AWS; no access keys to leak or rotate). Locally
/// (outside AWS) the AWS SDK falls back to the default credential chain
/// (~/.aws/credentials, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars,
/// etc) the same way the AWS CLI does.
/// </summary>
public class S3FileStorageService : IFileStorageService
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public S3FileStorageService(IAmazonS3 s3, string bucket)
    {
        _s3 = s3;
        _bucket = bucket;
    }

    public async Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var request = new PutObjectRequest
        {
            BucketName  = _bucket,
            Key         = key,
            InputStream = content,
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
            // Documents are financial/KYC PII — never publicly readable.
            // Access only ever happens through the authenticated,
            // ownership-checked DownloadDocument controller endpoints,
            // which fetch via this same S3 client (the task's IAM role),
            // never a public/presigned URL.
            CannedACL = S3CannedACL.Private
        };
        await _s3.PutObjectAsync(request, ct);
    }

    public async Task<(Stream Content, string? ContentType)?> GetAsync(string key, CancellationToken ct = default)
    {
        try
        {
            var response = await _s3.GetObjectAsync(_bucket, key, ct);
            return (response.ResponseStream, response.Headers.ContentType);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken ct = default)
    {
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, key, ct);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }
    }
}
