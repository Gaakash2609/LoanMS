using LoanMS.API.Services;
using Moq;

namespace LoanMS.Tests.TestHelpers;

/// <summary>
/// Permissive <see cref="IRolePermissionService"/> stub.
///
/// IRolePermissionService layers the Admin-configurable Roles-and-Permissions
/// matrix on top of (never instead of) the fixed [Authorize(Roles = ...)]
/// attributes. Allowing everything reproduces a matrix saved with every
/// permission switched on, and keeps each suite focused on the behaviour it
/// actually asserts rather than on permission-matrix configuration. (The real
/// service fails CLOSED to per-role defaults — see RolePermissionFailClosedTests.)
///
/// Controllers that take this dependency gained it after these suites were
/// written, which is what left the test project unable to compile.
///
/// A test that wants to assert DENIED behaviour should build its own mock
/// rather than use this one.
/// </summary>
internal static class RolePermissionTestDouble
{
    public static IRolePermissionService AllowAll()
    {
        var mock = new Mock<IRolePermissionService>();
        mock.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), It.IsAny<string>()))
            .ReturnsAsync(true);
        mock.Setup(r => r.IsMenuAllowedAsync(It.IsAny<string?>(), It.IsAny<string>()))
            .ReturnsAsync(true);
        mock.Setup(r => r.GetDeniedPermissionsAsync(It.IsAny<string?>(), It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync(new HashSet<string>());
        return mock.Object;
    }
}
