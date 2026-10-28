package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AdminUserQueryTest {
    @Test void legacyPaginationKeepsDescendingIdOrderAndNoFilters() {
        var query = AdminUserQuery.page(2, 25);
        assertEquals("id", query.sort()); assertEquals("desc", query.order());
        assertEquals("", query.search()); assertNull(query.systemRole()); assertNull(query.status());
    }
    @Test void supportedFiltersPreserveLiteralSearchCharacters() {
        var query = new AdminUserQuery(1, 10, "  %_'name  ", SystemRole.USER, UserStatus.DISABLED, "displayName", "asc");
        assertEquals("%_'name", query.search());
        assertEquals(SystemRole.USER, query.systemRole()); assertEquals(UserStatus.DISABLED, query.status());
    }
    @Test void unsupportedSqlIdentifiersDirectionsAndPaginationAreRejected() {
        assertThrows(ValidationException.class, () -> new AdminUserQuery(1, 25, "", null, null, "username DESC;--", "asc"));
        assertThrows(ValidationException.class, () -> new AdminUserQuery(1, 25, "", null, null, "username", "desc, id"));
        assertThrows(ValidationException.class, () -> AdminUserQuery.page(0, 25));
        assertThrows(ValidationException.class, () -> AdminUserQuery.page(1, 101));
        assertThrows(ValidationException.class, () -> new AdminUserQuery(1, 25, "x".repeat(161), null, null, null, null));
    }
}
