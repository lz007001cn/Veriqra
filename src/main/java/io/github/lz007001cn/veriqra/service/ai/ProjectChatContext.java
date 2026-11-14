package io.github.lz007001cn.veriqra.service.ai;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A bounded project snapshot collected from authorized reads, never from the conversation. */
public record ProjectChatContext(ProjectInfo project, Map<String, Section> sections, List<Source> sources,
                                 boolean truncated) {
    public ProjectChatContext {
        sections = Collections.unmodifiableMap(new LinkedHashMap<>(sections));
        sources = List.copyOf(sources);
    }

    public record ProjectInfo(Long id, String key, String name, String status, String description) { }
    public record Source(String type, Long id, String label) { }
    public record Section(long total, long omittedCount, Map<String, Long> counts, List<Item> items) {
        public Section {
            counts = Collections.unmodifiableMap(new LinkedHashMap<>(counts));
            items = List.copyOf(items);
        }
    }
    public record Item(Source source, Map<String, Object> facts) {
        public Item { facts = Collections.unmodifiableMap(new LinkedHashMap<>(facts)); }
    }
}
