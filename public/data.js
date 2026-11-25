export const rooms=[{id:'general',name:'팀 라운지',description:'가벼운 인사부터 새로운 아이디어까지, 우리 팀의 열린 공간',icon:'coffee'},{id:'project',name:'프로젝트 네오워크',description:'함께 만드는 더 나은 협업, NeoWork MVP 프로젝트',icon:'hash'},{id:'design',name:'디자인 스튜디오',description:'작은 디테일이 좋은 경험을 만듭니다.',icon:'palette'},{id:'dev',name:'개발 이야기',description:'기술적인 고민과 개발 진행 상황을 나눠요.',icon:'code'}];
const day=new Date();day.setHours(10,0,0,0);const at=(m)=>new Date(day.getTime()+m*60000).toISOString();
export const messages=[
{id:'m1',room:'project',name:'김민지',text:'좋은 아침이에요! 🌿 이번 주 MVP 진행 상황을 여기서 같이 정리해 봐요. 목요일까지 핵심 기능을 완성하는 게 목표입니다.',time:at(0)},
{id:'m2',room:'project',name:'박준호',text:'채팅 기능이랑 메시지 저장은 제가 맡을게요. 수요일까지 구현하겠습니다.',time:at(2)},
{id:'m3',room:'project',name:'이서연',text:'저는 채팅 화면 UI 디자인을 담당할게요. 오늘 오후까지 시안 정리해서 공유하겠습니다!',time:at(4)},
{id:'m4',room:'project',name:'김민지',text:'좋아요! AI 요약과 자연어 검색은 제가 맡아서 진행할게요. 목요일까지 연결하겠습니다.',time:at(6)},
{id:'m5',room:'project',name:'정우진',text:'저는 테스트 시나리오 작성을 맡을게요. 금요일 발표 전에 같이 테스트하면 좋겠어요.',time:at(8)},
{id:'m6',room:'project',name:'이서연',text:'채팅 화면 UI 디자인 완료했어요! 사이드바는 편안한 올리브 톤으로, 대화에 집중할 수 있게 구성했습니다. ✨',time:at(35)},
{id:'m7',room:'project',name:'박준호',text:'디자인 좋네요! 채팅 기능은 지금 구현 중이에요. 메시지 저장까지 연결하고 공유하겠습니다.',time:at(37)},
{id:'m8',room:'project',name:'김민지',text:'이번 MVP에서는 파일 업로드는 제외하고, 채팅 · 요약 · 검색에 집중하기로 결정했어요. 모두 이 방향으로 진행해 주세요 🙌',time:at(40)},
{id:'m9',room:'project',name:'김민지',text:'출시 전 팀 검수는 목요일 오후 3시에 진행하기로 결정했어요. 이 시간에 각자 맡은 기능을 함께 확인하겠습니다.',time:at(42)},
{id:'m10',room:'project',name:'정우진',text:'데모 발표는 금요일 오전 10시에 진행하기로 결정했습니다. 이 시간에 맞춰 발표를 준비하겠습니다.',time:at(44)},
{id:'g1',room:'general',name:'김민지',text:'우리 팀의 새로운 작업 공간에 오신 걸 환영해요! 자유롭게 이야기 나눠 주세요. ☕',time:at(0)},
{id:'d1',room:'design',name:'이서연',text:'디자인 원칙은 단순함과 편안함으로 정했어요. 올리브 컬러를 포인트로 사용합니다.',time:at(10)},
{id:'v1',room:'dev',name:'박준호',text:'개발 관련 질문이나 진행 상황은 이 채널에서 공유해 주세요!',time:at(10)}];
export const people=[{name:'김민지',role:'기획 · AI 개발',color:'olive'},{name:'박준호',role:'백엔드 개발',color:'blue'},{name:'이서연',role:'UI/UX 디자인',color:'orange'},{name:'정우진',role:'QA · 발표',color:'purple'}];

// Upgrade only an untouched earlier sample, never a user's edited conversation.
export function upgradeSampleMessages(stored){
 const additions=messages.filter(m=>m.id==='m9'||m.id==='m10'),original=messages.filter(m=>!additions.includes(m));
 if(!Array.isArray(stored)||stored.length!==original.length||!original.every(seed=>stored.some(m=>m.id===seed.id&&m.room===seed.room&&m.name===seed.name&&m.text===seed.text)))return stored;
 const last=Date.parse(stored.find(m=>m.id==='m8').time);if(!Number.isFinite(last))return stored;
 return [...stored,...additions.map((m,index)=>({...m,time:new Date(last+(index+1)*120000).toISOString()}))];
}
