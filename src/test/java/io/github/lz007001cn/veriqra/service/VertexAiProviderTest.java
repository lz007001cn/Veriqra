package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.ai.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import static org.junit.jupiter.api.Assertions.*;

class VertexAiProviderTest {
    final VertexAiProvider provider = new VertexAiProvider(new AiConfig(null,"global","gemini-2.5-flash",null));
    String row = """
            {"title":"登录","description":"检查登录","preconditions":"已注册","priority":"HIGH",
            "steps":[{"action":"输入账号并提交","expectedResult":"进入首页"}]}
            """;
    @Test void parsesStructuredCandidatesAndRejectsTruncatedOrMalformedAnswers() {
        var result = provider.parseCandidates("[" + String.join(",",row,row,row) + "]");
        assertEquals(3,result.size()); assertEquals(1,result.getFirst().steps().getFirst().stepOrder());
        for (String bad : new String[]{"[]","["+row+"]","[","{}","["+String.join(",",row,row,row.replace("HIGH","CRITICAL"))+"]"}) {
            assertEquals("AI_INVALID_RESPONSE",assertThrows(AiUnavailableException.class,()->provider.parseCandidates(bad)).code());
        }
    }
    @Test void absentConfigurationHasExplicitManualFallback() {
        assertEquals("AI_NOT_CONFIGURED",assertThrows(AiUnavailableException.class,()->provider.generate(requirement(),null)).code());
    }
    Requirement requirement() { return new Requirement(1L,1L,1L,"用户登录","验收条件：有效账号进入首页；密码错误显示提示；用户名为空不可提交。",Priority.HIGH,RequirementStatus.ACTIVE,1L,null,null,0); }
    @Test @EnabledIfSystemProperty(named="veriqra.ai.live",matches="true")
    void realVertexConnectionGeneratesCandidates() {
        var result = new VertexAiProvider(AiConfig.load()).generate(requirement(),"生成三条中文测试用例");
        assertTrue(result.size() >= 3 && result.size() <= 5);
        assertTrue(result.stream().allMatch(c -> !c.steps().isEmpty()));
    }
}
