package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;

/** Project questions use a scoped snapshot. General conversations use only their own turns. */
public final class ProjectChatService {
    public record Message(String role, String text) { }
    public record Reply(String answer, List<ProjectChatContext.Source> sources, boolean truncated) { }
    public record Analysis(String answer, List<String> references) { }

    @FunctionalInterface
    public interface Provider {
        Analysis answer(ProjectChatContext context, String question, List<Message> history, String language);

        default String answerGeneral(String question, List<Message> history, String language) {
            throw new AiUnavailableException("AI_NOT_CONFIGURED");
        }
    }

    private final ProjectChatContextLoader loader;
    private final Provider provider;

    public ProjectChatService(ProjectChatContextLoader loader, Provider provider) {
        this.loader = Objects.requireNonNull(loader);
        this.provider = Objects.requireNonNull(provider);
    }

    public Reply ask(Long actor, Long projectId, String question, List<Message> history, String language) {
        List<Message> turns = validateConversation(projectId, question, history, language);
        String input = question.strip();
        ProjectChatContext context = loader.load(actor, projectId, input);
        Analysis analysis = provider.answer(context, input, turns, language);
        loader.requireAccess(actor, projectId);
        if (analysis == null || !validText(analysis.answer(), 6000) || analysis.references() == null
                || analysis.references().size() > 8) {
            throw new AiUnavailableException("AI_INVALID_RESPONSE");
        }

        var byKey = new LinkedHashMap<String, ProjectChatContext.Source>();
        for (var source : context.sources()) byKey.put(source.type() + ":" + source.id(), source);
        List<ProjectChatContext.Source> sources = analysis.references().stream().distinct()
                .map(byKey::get).filter(Objects::nonNull).toList();
        return new Reply(analysis.answer().strip(), sources, context.truncated());
    }

    public void requireAccess(Long actor, Long projectId) {
        loader.requireAccess(actor, projectId);
    }

    public Reply askGeneral(Long actor, Long projectId, String question, List<Message> history, String language) {
        List<Message> turns = validateConversation(projectId, question, history, language);
        loader.requireAccess(actor, projectId);
        String answer = provider.answerGeneral(question.strip(), turns, language);
        loader.requireAccess(actor, projectId);
        if (!validText(answer, 6000)) throw new AiUnavailableException("AI_INVALID_RESPONSE");
        return new Reply(answer.strip(), List.of(), false);
    }

    private static List<Message> validateConversation(Long projectId, String question, List<Message> history, String language) {
        if (projectId == null || projectId <= 0 || !validText(question, 1500)) {
            throw new ValidationException("A project and question of up to 1500 characters are required");
        }
        if (language != null && !language.equals("en") && !language.equals("zh-CN")) {
            throw new ValidationException("Unsupported chat language");
        }
        List<Message> turns = history == null ? List.of() : history;
        if (turns.size() > 8 || turns.size() % 2 != 0) {
            throw new ValidationException("Chat history must contain up to four question and answer pairs");
        }
        for (int i = 0; i < turns.size(); i++) {
            Message message = turns.get(i);
            boolean user = i % 2 == 0;
            if (message == null || !(user ? "user" : "assistant").equals(message.role())
                    || !validText(message.text(), user ? 1500 : 6000)) {
                throw new ValidationException("Invalid chat history");
            }
        }
        return List.copyOf(turns);
    }

    private static boolean validText(String text, int max) {
        return text != null && !text.isBlank() && text.length() <= max;
    }
}
