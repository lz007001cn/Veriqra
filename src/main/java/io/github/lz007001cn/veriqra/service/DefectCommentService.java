package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.ProjectStatus;
import io.github.lz007001cn.veriqra.service.exception.ConflictException;
import io.github.lz007001cn.veriqra.service.exception.NotFoundException;
import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import io.github.lz007001cn.veriqra.service.support.ProjectAccessPolicy;
import io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory;
import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;

/** Append-only discussion attached to a defect. Screenshot bytes are read only by the image route. */
public final class DefectCommentService {
    public static final int MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    public static final int MAX_ENCODED_IMAGE = ((MAX_IMAGE_BYTES + 2) / 3) * 4;
    private static final int PAGE_SIZE = 50;
    private static final int MAX_IMAGE_PIXELS = 20_000_000;
    private static final byte[] PNG_HEADER = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10};
    private static final String COMMENT_SELECT = """
            SELECT c.id,c.author_id,u.display_name,c.created_at,c.comment_text,c.log_url,
                   c.image_content_type IS NOT NULL AS has_image
            FROM defect_comments c JOIN users u ON u.id=c.author_id
            """;
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;

    public record Comment(long id, long authorId, String authorName, LocalDateTime createdAt,
                          String text, String logUrl, boolean hasImage) { }
    public record Page(List<Comment> comments, Long nextBeforeId) { }
    public record Posted(Comment comment, boolean replayed) { }
    public record Image(String contentType, byte[] bytes) { }
    public static final class ScreenshotException extends RuntimeException {
        private final boolean tooLarge;
        private ScreenshotException(String message, boolean tooLarge) { super(message); this.tooLarge = tooLarge; }
        public boolean tooLarge() { return tooLarge; }
    }

    public DefectCommentService(ServiceTransaction transactions, ServiceDaoFactory factory, ProjectAccessPolicy access) {
        this.transactions = Objects.requireNonNull(transactions);
        this.factory = Objects.requireNonNull(factory);
        this.access = Objects.requireNonNull(access);
    }

    public Page list(Long actor, long project, long defect, Long beforeId) {
        return transactions.execute(connection -> {
            authorize(connection, actor, project, defect, false);
            String sql = COMMENT_SELECT + " WHERE c.defect_id=?" + (beforeId == null ? "" : " AND c.id<?") + " ORDER BY c.id DESC LIMIT " + (PAGE_SIZE + 1);
            try (var statement = connection.prepareStatement(sql)) {
                statement.setLong(1, defect);
                if (beforeId != null) statement.setLong(2, beforeId);
                try (var rows = statement.executeQuery()) {
                    var comments = new ArrayList<Comment>();
                    while (rows.next()) comments.add(comment(rows));
                    Long next = null;
                    if (comments.size() > PAGE_SIZE) {
                        comments.removeLast();
                        next = comments.getLast().id();
                    }
                    return new Page(List.copyOf(comments), next);
                }
            } catch (SQLException e) { throw new DataAccessException("Read defect discussion", e); }
        });
    }

    public Posted add(Long actor, long project, long defect, String requestKey, String text, String logUrl, String imageBase64) {
        String key = uuid(requestKey);
        String body = text == null ? "" : text.strip();
        if (body.length() > 4000) throw new ValidationException("Comment text exceeds 4000 characters");
        String url = httpUrl(logUrl);
        Image image = decodeImage(imageBase64);
        if (body.isEmpty() && url == null && image == null) throw new ValidationException("Enter a comment or attach evidence");
        byte[] digest = fingerprint(body, url, image);
        return transactions.execute(connection -> {
            // The defect lock serializes equal request keys, without changing the defect's revision.
            authorize(connection, actor, project, defect, true);
            try (var lookup = connection.prepareStatement("SELECT id,payload_sha256 FROM defect_comments WHERE defect_id=? AND author_id=? AND request_key=? FOR UPDATE")) {
                lookup.setLong(1, defect);
                lookup.setLong(2, actor);
                lookup.setString(3, key);
                Long replayId = null;
                try (var rows = lookup.executeQuery()) {
                    if (rows.next()) {
                        if (!MessageDigest.isEqual(digest, rows.getBytes(2))) throw new ConflictException("Comment request key already used for other content");
                        replayId = rows.getLong(1);
                    }
                }
                if (replayId != null) return new Posted(find(connection, replayId), true);
                long id = insert(connection, defect, actor, key, body, url, image, digest);
                return new Posted(find(connection, id), false);
            } catch (SQLException e) { throw new DataAccessException("Save defect comment", e); }
        });
    }

    public Image image(Long actor, long project, long defect, long commentId) {
        return transactions.execute(connection -> {
            authorize(connection, actor, project, defect, false);
            String sql = "SELECT image_content_type,image_bytes FROM defect_comments WHERE defect_id=? AND id=? AND image_content_type IS NOT NULL";
            try (var statement = connection.prepareStatement(sql)) {
                statement.setLong(1, defect);
                statement.setLong(2, commentId);
                try (var rows = statement.executeQuery()) {
                    if (!rows.next()) throw new NotFoundException("Screenshot not found");
                    return new Image(rows.getString(1), rows.getBytes(2));
                }
            } catch (SQLException e) { throw new DataAccessException("Read defect screenshot", e); }
        });
    }

    private void authorize(Connection connection, Long actor, long project, long defect, boolean write) {
        var daos = factory.create(connection);
        var row = (write ? daos.projects().findByIdForShare(project) : daos.projects().findById(project))
                .orElseThrow(() -> new NotFoundException("Project not found"));
        if (write) {
            access.requireProjectMemberWrite(daos.users(), daos.members(), actor, project);
            if (row.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        } else access.requireProjectRead(daos.users(), daos.members(), actor, project);
        daos.defects().findById(defect).filter(value -> value.projectId().equals(project))
                .orElseThrow(() -> new NotFoundException("Defect not found in project"));
        if (write) daos.defects().findByIdForUpdate(defect).filter(value -> value.projectId().equals(project))
                .orElseThrow(() -> new NotFoundException("Defect not found in project"));
    }

    private static long insert(Connection connection, long defect, long actor, String key, String text,
                               String url, Image image, byte[] digest) throws SQLException {
        String sql = "INSERT INTO defect_comments (defect_id,author_id,request_key,comment_text,log_url,image_content_type,image_bytes,payload_sha256) VALUES (?,?,?,?,?,?,?,?)";
        try (var statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            statement.setLong(1, defect);
            statement.setLong(2, actor);
            statement.setString(3, key);
            statement.setString(4, text);
            statement.setString(5, url);
            statement.setString(6, image == null ? null : image.contentType());
            statement.setBytes(7, image == null ? null : image.bytes());
            statement.setBytes(8, digest);
            if (statement.executeUpdate() != 1) throw new SQLException("Unexpected comment insert count");
            try (var keys = statement.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Missing comment key");
                return keys.getLong(1);
            }
        }
    }

    private static Comment find(Connection connection, long id) throws SQLException {
        try (var statement = connection.prepareStatement(COMMENT_SELECT + " WHERE c.id=?")) {
            statement.setLong(1, id);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) throw new SQLException("Saved comment not found");
                return comment(rows);
            }
        }
    }

    private static Comment comment(ResultSet rows) throws SQLException {
        return new Comment(rows.getLong("id"), rows.getLong("author_id"), rows.getString("display_name"),
                rows.getObject("created_at", LocalDateTime.class), rows.getString("comment_text"),
                rows.getString("log_url"), rows.getBoolean("has_image"));
    }

    private static String uuid(String value) {
        if (value != null && value.length() == 36) {
            try { return UUID.fromString(value).toString(); }
            catch (IllegalArgumentException ignored) { }
        }
        throw new ValidationException("A valid comment request key is required");
    }

    private static String httpUrl(String value) {
        if (value == null || value.isBlank()) return null;
        if (value.length() <= 2048) {
            try {
                URI uri = URI.create(value.strip());
                String scheme = uri.getScheme();
                if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && uri.getHost() != null && uri.getUserInfo() == null) {
                    String ascii = uri.toASCIIString();
                    if (ascii.length() <= 2048) return ascii;
                }
            } catch (IllegalArgumentException ignored) { }
        }
        throw new ValidationException("Enter a valid HTTP or HTTPS log link");
    }

    private static Image decodeImage(String value) {
        if (value == null || value.isEmpty()) return null;
        if (value.length() > MAX_ENCODED_IMAGE) throw new ScreenshotException("Screenshot exceeds 2 MiB", true);
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(value); }
        catch (IllegalArgumentException e) { throw invalidImage(); }
        if (bytes.length > MAX_IMAGE_BYTES) throw new ScreenshotException("Screenshot exceeds 2 MiB", true);
        boolean png = bytes.length >= PNG_HEADER.length && Arrays.equals(bytes, 0, PNG_HEADER.length, PNG_HEADER, 0, PNG_HEADER.length);
        boolean jpeg = bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255;
        if (!png && !jpeg) throw invalidImage();
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalidImage();
            var reader = readers.next();
            try {
                if (!(png ? "PNG" : "JPEG").equalsIgnoreCase(reader.getFormatName())) throw invalidImage();
                reader.setInput(input, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width <= 0 || height <= 0 || width > 8192 || height > 8192 || (long) width * height > MAX_IMAGE_PIXELS)
                    throw new ScreenshotException("Screenshot dimensions are too large", true);
                var parameters = reader.getDefaultReadParam();
                int sampling = Math.max(1, (Math.max(width, height) + 511) / 512);
                parameters.setSourceSubsampling(sampling, sampling, 0, 0);
                if (reader.read(0, parameters) == null) throw invalidImage();
            } finally { reader.dispose(); }
        } catch (IOException | IllegalArgumentException e) { throw invalidImage(); }
        return new Image(png ? "image/png" : "image/jpeg", bytes);
    }

    private static ScreenshotException invalidImage() { return new ScreenshotException("Choose a valid PNG or JPEG screenshot", false); }

    private static byte[] fingerprint(String text, String url, Image image) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            part(digest, text.getBytes(StandardCharsets.UTF_8));
            part(digest, url == null ? new byte[0] : url.getBytes(StandardCharsets.UTF_8));
            part(digest, image == null ? new byte[0] : image.bytes());
            return digest.digest();
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static void part(MessageDigest digest, byte[] value) {
        digest.update(ByteBuffer.allocate(4).putInt(value.length).array());
        digest.update(value);
    }
}
