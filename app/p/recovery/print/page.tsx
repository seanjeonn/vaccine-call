import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireParent } from "@/lib/auth";
import type {
  DamageMethod,
  InterviewAnswers,
  RecoveryDocuments,
} from "@/lib/recovery";
import PrintButton from "@/components/print-button";

export const metadata: Metadata = { title: "서류 인쇄 · 백신콜" };

const dateText = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

// 어림잡아 답한 만원 단위를 서식에 쓰는 원 단위로 바꾼다. 숫자가 아니면 빈칸으로 둔다.
function amountText(amount: string | undefined): string | null {
  const man = Number(amount);
  if (!amount || !Number.isFinite(man) || man <= 0) return null;
  return `${(man * 10000).toLocaleString("ko-KR")}원`;
}

// 서류 초안 인쇄 화면(F4-2). 시행령 별지 제1호서식의 구조를 그대로 따르되,
// 실명·생년월일·계좌번호 같은 민감정보는 수집하지 않으므로 빈칸으로 남겨 손으로 적게 한다.
export default async function RecoveryPrintPage() {
  const parentId = await requireParent();
  const recoveryCase = await prisma.recoveryCase.findUnique({ where: { parentId } });
  if (!recoveryCase) redirect("/p/recovery");
  if (!recoveryCase.documents) redirect("/p/recovery/docs");

  const method = recoveryCase.method as DamageMethod;
  const documents = recoveryCase.documents as unknown as RecoveryDocuments;
  const answers = (recoveryCase.answers as InterviewAnswers | null) ?? {};
  const amount = amountText(answers.amount);
  const today = new Date();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="no-print flex flex-col gap-4">
        <h1 className="text-3xl font-bold leading-snug">서류가 준비됐어요</h1>
        <p className="text-xl leading-relaxed text-neutral-400">
          {method === "transfer"
            ? "인쇄한 뒤 밑줄 친 빈칸만 손으로 적어주세요. 신분증 사본과 함께 은행에 내시면 됩니다."
            : "인쇄한 뒤 경찰 진술이나 은행 제출에 쓰시면 됩니다. 빈칸은 손으로 적어주세요."}
        </p>
        <PrintButton />
      </div>

      <div className="print-sheet mt-8 rounded-2xl bg-white p-8 text-black">
        {method === "transfer" && (
          <section className="print-page">
            <p className="text-right text-[11px] text-neutral-500">
              전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법 시행령 [별지 제1호서식]
            </p>

            <table className="mt-2 w-full border-collapse text-[11px]">
              <tbody>
                <tr>
                  <Th narrow>접수번호</Th>
                  <td className="border border-neutral-400 bg-neutral-100 px-2 py-2" />
                  <Th narrow>접수일자</Th>
                  <td className="border border-neutral-400 bg-neutral-100 px-2 py-2" />
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-neutral-500">
              ※ 색상이 어두운 란은 신청인이 적지 않습니다.
            </p>

            <h2 className="my-5 text-center text-2xl font-bold tracking-[0.4em]">
              피해구제신청서
            </h2>

            <FormTitle>피해자</FormTitle>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                <tr>
                  <Th>성명</Th>
                  <Td>
                    <Blank />
                  </Td>
                  <Th>생년월일</Th>
                  <Td>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>주소</Th>
                  <Td colSpan={3}>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>전화번호</Th>
                  <Td>
                    <Blank />
                  </Td>
                  <Th>휴대전화번호</Th>
                  <Td>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>전자우편주소</Th>
                  <Td colSpan={3}>
                    <Blank />
                  </Td>
                </tr>
              </tbody>
            </table>

            <FormTitle>신청내용</FormTitle>
            <p className="mb-1 text-[11px] font-bold">1. 피해자 계좌의 송금·이체 내역</p>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                <tr>
                  <Th>금융회사</Th>
                  <Td>{answers.myBank?.trim() || <Blank />}</Td>
                  <Th>개설점포</Th>
                  <Td>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>예금종별</Th>
                  <Td>
                    <Blank />
                  </Td>
                  <Th>계좌번호</Th>
                  <Td>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>명의인</Th>
                  <Td>
                    <Blank />
                  </Td>
                  <Th>송금·이체일시</Th>
                  <Td>{dateText(recoveryCase.incidentAt)}</Td>
                </tr>
                <tr>
                  <Th>금액</Th>
                  <Td colSpan={3}>{amount ?? <Blank />}</Td>
                </tr>
              </tbody>
            </table>

            <p className="mb-1 mt-3 text-[11px] font-bold">2. 사기이용계좌 입금 내역</p>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                <tr>
                  <Th>금융회사</Th>
                  <Td>{answers.scammerBank?.trim() || <Blank />}</Td>
                  <Th>계좌번호</Th>
                  <Td>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>명의인</Th>
                  <Td>
                    <Blank />
                  </Td>
                  <Th>입금일시</Th>
                  <Td>{dateText(recoveryCase.incidentAt)}</Td>
                </tr>
                <tr>
                  <Th>금액</Th>
                  <Td colSpan={3}>{amount ?? <Blank />}</Td>
                </tr>
              </tbody>
            </table>

            <p className="mb-1 mt-3 text-[11px] font-bold">3. 피해환급금 입금계좌</p>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                <tr>
                  <Th>금융회사</Th>
                  <Td>
                    <Blank />
                  </Td>
                  <Th>계좌번호</Th>
                  <Td>
                    <Blank />
                  </Td>
                </tr>
                <tr>
                  <Th>명의인</Th>
                  <Td colSpan={3}>
                    <Blank />
                  </Td>
                </tr>
              </tbody>
            </table>

            <FormTitle>피해구제 신청사유</FormTitle>
            <div className="min-h-[7rem] whitespace-pre-wrap border border-neutral-400 px-3 py-3 text-[12px] leading-relaxed">
              {documents.applicationReason}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-neutral-600">
              ※ 거짓으로 피해구제를 신청하는 경우에는 법 제16조제1호에 따라 3년 이하의 징역 또는
              3천만원 이하의 벌금을 받을 수 있습니다.
            </p>

            <p className="mt-5 text-center text-[12px] leading-relaxed">
              「전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법」 제3조제1항 및 같은 법
              시행령 제3조제1항에 따라 위와 같이 피해구제를 신청합니다.
            </p>

            <p className="mt-5 text-center text-[12px]">{dateText(today)}</p>
            <p className="mt-3 text-right text-[12px]">
              신청인 <Blank width="8rem" /> (서명 또는 인)
            </p>
            <p className="mt-4 text-[12px] font-bold">
              {answers.myBank?.trim() ? `${answers.myBank.trim()}` : <Blank width="8rem" />} 귀하
            </p>

            <table className="mt-5 w-full border-collapse text-[11px]">
              <tbody>
                <tr>
                  <Th narrow>첨부서류</Th>
                  <Td>피해자의 신분증 사본 1부</Td>
                  <Th narrow>수수료</Th>
                  <Td>없음</Td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        <section className={method === "transfer" ? "print-page mt-10" : "print-page"}>
          <h2 className="my-5 text-center text-2xl font-bold tracking-[0.4em]">피해 경위서</h2>
          <div className="whitespace-pre-wrap text-[13px] leading-loose">
            {documents.narrative}
          </div>
          <p className="mt-6 text-right text-[12px]">{dateText(today)}</p>
          <p className="mt-2 text-right text-[12px]">
            작성자 <Blank width="8rem" /> (서명 또는 인)
          </p>
          <p className="mt-5 text-[10px] leading-relaxed text-neutral-600">
            ※ 통화 녹음, 문자·메신저 화면, 이체 확인증 등 증거가 있으면 함께 제출하시면 좋습니다.
          </p>
        </section>
      </div>

      <div className="no-print mt-8 flex flex-col gap-3">
        <p className="text-center text-lg leading-relaxed text-neutral-500">
          이 서류는 AI가 만든 초안입니다. 내용이 사실과 다르면 손으로 고쳐서 내세요.
        </p>
        <Link
          href="/p/recovery/docs?again=1"
          className="rounded-full border-2 border-neutral-600 py-5 text-center text-xl font-bold transition hover:border-neutral-400"
        >
          다시 만들기
        </Link>
        <Link href="/p/recovery" className="text-center text-lg text-neutral-500 underline">
          체크리스트로 돌아가기
        </Link>
      </div>
    </main>
  );
}

const FormTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-1 mt-4 text-[13px] font-bold">{children}</p>
);

const Th = ({
  children,
  narrow = false,
}: {
  children: React.ReactNode;
  narrow?: boolean;
}) => (
  <th
    className={
      "border border-neutral-400 bg-neutral-100 px-2 py-2 text-left font-normal " +
      (narrow ? "w-20" : "w-24")
    }
  >
    {children}
  </th>
);

const Td = ({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) => (
  <td className="border border-neutral-400 px-2 py-2" colSpan={colSpan}>
    {children}
  </td>
);

// 민감정보 칸. 인쇄한 뒤 본인이 손으로 적는다.
const Blank = ({ width = "100%" }: { width?: string }) => (
  <span
    className="inline-block border-b border-dotted border-neutral-500 align-baseline"
    style={{ width, minWidth: "4rem", height: "1.1em" }}
  />
);
