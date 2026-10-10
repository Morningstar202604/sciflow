/**
 * 官方 CSL 样式模板（内嵌字符串）
 *
 * ⚠️ 本文件由 scripts/gen-csl-templates.mjs 生成，请勿手改；
 *    更新样式请改脚本里的 TEMPLATES 后重跑。
 *
 * 背景：citation-js 0.8.x 仅内置 apa/vancouver/harvard1 三种样式，
 *      其余 6 种（IEEE / GB-T 7714 / Nature / Chicago / Springer / ACS）
 *      需要在此用官方 API（plugins.config.get('@csl').styles.add）注册。
 */

/** ieee.csl · 源自 citation-style-language/styles（https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/ieee.csl） */
export const IEEE_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" demote-non-dropping-particle="sort-only">
  <info>
    <title>IEEE Reference Guide version 11.29.2023</title>
    <title-short>Institute of Electrical and Electronics Engineers</title-short>
    <id>http://www.zotero.org/styles/ieee</id>
    <link href="http://www.zotero.org/styles/ieee" rel="self"/>
    <link href="https://journals.ieeeauthorcenter.ieee.org/your-role-in-article-production/ieee-editorial-style-manual/" rel="documentation"/>
    <author>
      <name>Michael Berkowitz</name>
      <email>mberkowi@gmu.edu</email>
    </author>
    <contributor>
      <name>Julian Onions</name>
      <email>julian.onions@gmail.com</email>
    </contributor>
    <contributor>
      <name>Rintze Zelle</name>
      <uri>http://twitter.com/rintzezelle</uri>
    </contributor>
    <contributor>
      <name>Stephen Frank</name>
      <uri>http://www.zotero.org/sfrank</uri>
    </contributor>
    <contributor>
      <name>Sebastian Karcher</name>
    </contributor>
    <contributor>
      <name>Giuseppe Silano</name>
      <email>g.silano89@gmail.com</email>
      <uri>http://giuseppesilano.net</uri>
    </contributor>
    <contributor>
      <name>Patrick O'Brien</name>
    </contributor>
    <contributor>
      <name>Brenton M. Wiernik</name>
    </contributor>
    <contributor>
      <name>Oliver Couch</name>
      <email>oliver.couch@gmail.com</email>
    </contributor>
    <contributor>
      <name>Andrew Dunning</name>
      <uri>https://orcid.org/0000-0003-0464-5036</uri>
    </contributor>
    <category citation-format="numeric"/>
    <category field="engineering"/>
    <category field="generic-base"/>
    <summary>IEEE style as per the 2023 guidelines.</summary>
    <updated>2024-03-27T11:41:27+00:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale xml:lang="en">
    <date form="text">
      <date-part name="month" form="short" suffix=" "/>
      <date-part name="day" form="numeric-leading-zeros" suffix=", "/>
      <date-part name="year"/>
    </date>
    <terms>
      <term name="chapter" form="short">ch.</term>
      <term name="chapter-number" form="short">ch.</term>
      <term name="presented at">presented at the</term>
      <term name="available at">available</term>
      <!-- always use three-letter abbreviations for months -->
      <term name="month-06" form="short">Jun.</term>
      <term name="month-07" form="short">Jul.</term>
      <term name="month-09" form="short">Sep.</term>
    </terms>
  </locale>
  <!-- Macros -->
  <macro name="status">
    <choose>
      <if variable="page issue volume" match="none">
        <text variable="status" text-case="capitalize-first" suffix="" font-weight="bold"/>
      </if>
    </choose>
  </macro>
  <macro name="edition">
    <choose>
      <if type="bill book chapter graphic legal_case legislation motion_picture paper-conference report song" match="any">
        <choose>
          <if is-numeric="edition">
            <group delimiter=" ">
              <number variable="edition" form="ordinal"/>
              <text term="edition" form="short"/>
            </group>
          </if>
          <else>
            <text variable="edition" text-case="capitalize-first" suffix="."/>
          </else>
        </choose>
      </if>
    </choose>
  </macro>
  <macro name="issued">
    <choose>
      <if type="article-journal report" match="any">
        <date variable="issued">
          <date-part name="month" form="short" suffix=" "/>
          <date-part name="year" form="long"/>
        </date>
      </if>
      <else-if type="bill book chapter graphic legal_case legislation song thesis" match="any">
        <date variable="issued">
          <date-part name="year" form="long"/>
        </date>
      </else-if>
      <else-if type="paper-conference" match="any">
        <date variable="issued">
          <date-part name="month" form="short"/>
          <date-part name="year" prefix=" "/>
        </date>
      </else-if>
      <else-if type="motion_picture" match="any">
        <date variable="issued" form="text" prefix="(" suffix=")"/>
      </else-if>
      <else>
        <date variable="issued" form="text"/>
      </else>
    </choose>
  </macro>
  <macro name="author">
    <names variable="author">
      <name and="text" et-al-min="7" et-al-use-first="1" initialize-with=". "/>
      <label form="short" prefix=", " text-case="capitalize-first"/>
      <et-al font-style="italic"/>
      <substitute>
        <names variable="editor"/>
        <names variable="translator"/>
        <text macro="director"/>
      </substitute>
    </names>
  </macro>
  <macro name="editor">
    <names variable="editor">
      <name initialize-with=". " delimiter=", " and="text"/>
      <label form="short" prefix=", " text-case="capitalize-first"/>
    </names>
  </macro>
  <macro name="director">
    <names variable="director">
      <name and="text" et-al-min="7" et-al-use-first="1" initialize-with=". "/>
      <et-al font-style="italic"/>
    </names>
  </macro>
  <macro name="locators">
    <group delimiter=", ">
      <text macro="edition"/>
      <group delimiter=" ">
        <text term="volume" form="short"/>
        <number variable="volume" form="numeric"/>
      </group>
      <group delimiter=" ">
        <number variable="number-of-volumes" form="numeric"/>
        <text term="volume" form="short" plural="true"/>
      </group>
      <group delimiter=" ">
        <text term="issue" form="short"/>
        <number variable="issue" form="numeric"/>
      </group>
    </group>
  </macro>
  <macro name="title">
    <choose>
      <if type="bill book graphic legal_case legislation motion_picture song standard software" match="any">
        <text variable="title" font-style="italic"/>
      </if>
      <else>
        <text variable="title" quotes="true"/>
      </else>
    </choose>
  </macro>
  <macro name="publisher">
    <choose>
      <if type="bill book chapter graphic legal_case legislation motion_picture paper-conference song" match="any">
        <group delimiter=": ">
          <text variable="publisher-place"/>
          <text variable="publisher"/>
        </group>
      </if>
      <else>
        <group delimiter=", ">
          <text variable="publisher"/>
          <text variable="publisher-place"/>
        </group>
      </else>
    </choose>
  </macro>
  <macro name="event">
    <choose>
      <!-- Published Conference Paper -->
      <if type="paper-conference speech" match="any">
        <choose>
          <if variable="container-title" match="any">
            <group delimiter=" ">
              <text term="in"/>
              <text variable="container-title" font-style="italic"/>
            </group>
          </if>
          <!-- Unpublished Conference Paper -->
          <else>
            <group delimiter=" ">
              <text term="presented at"/>
              <text variable="event"/>
            </group>
          </else>
        </choose>
      </if>
    </choose>
  </macro>
  <macro name="access">
    <choose>
      <if type="webpage post post-weblog" match="any">
        <!-- https://url.com/ (accessed Mon. DD, YYYY). -->
        <choose>
          <if variable="URL">
            <group delimiter=". " prefix=" ">
              <group delimiter=": ">
                <text term="accessed" text-case="capitalize-first"/>
                <date variable="accessed" form="text"/>
              </group>
              <text term="online" prefix="[" suffix="]" text-case="capitalize-first"/>
              <group delimiter=": ">
                <text term="available at" text-case="capitalize-first"/>
                <text variable="URL"/>
              </group>
            </group>
          </if>
        </choose>
      </if>
      <else-if match="any" variable="DOI">
        <!-- doi: 10.1000/xyz123. -->
        <text variable="DOI" prefix=" doi: " suffix="."/>
      </else-if>
      <else-if variable="URL">
        <!-- Accessed: Mon. DD, YYYY. [Medium]. Available: https://URL.com/ -->
        <group delimiter=". " prefix=" " suffix=". ">
          <!-- Accessed: Mon. DD, YYYY. -->
          <group delimiter=": ">
            <text term="accessed" text-case="capitalize-first"/>
            <date variable="accessed" form="text"/>
          </group>
          <!-- [Online Video]. -->
          <group prefix="[" suffix="]" delimiter=" ">
            <choose>
              <if variable="medium" match="any">
                <text variable="medium" text-case="capitalize-first"/>
              </if>
              <else>
                <text term="online" text-case="capitalize-first"/>
                <choose>
                  <if type="motion_picture">
                    <text term="video" text-case="capitalize-first"/>
                  </if>
                </choose>
              </else>
            </choose>
          </group>
        </group>
        <!-- Available: https://URL.com/ -->
        <group delimiter=": " prefix=" ">
          <text term="available at" text-case="capitalize-first"/>
          <text variable="URL"/>
        </group>
      </else-if>
    </choose>
  </macro>
  <macro name="page">
    <choose>
      <if type="article-journal" variable="number" match="all">
        <group delimiter=" ">
          <text value="Art."/>
          <text term="issue" form="short"/>
          <text variable="number"/>
        </group>
      </if>
      <else>
        <group delimiter=" ">
          <label variable="page" form="short"/>
          <text variable="page"/>
        </group>
      </else>
    </choose>
  </macro>
  <macro name="citation-locator">
    <group delimiter=" ">
      <choose>
        <if locator="page">
          <label variable="locator" form="short"/>
        </if>
        <else>
          <label variable="locator" form="short" text-case="capitalize-first"/>
        </else>
      </choose>
      <text variable="locator"/>
    </group>
  </macro>
  <macro name="geographic-location">
    <group delimiter=", " suffix=".">
      <choose>
        <if variable="publisher-place">
          <text variable="publisher-place" text-case="title"/>
        </if>
        <else-if variable="event-place">
          <text variable="event-place" text-case="title"/>
        </else-if>
      </choose>
    </group>
  </macro>
  <!-- Series -->
  <macro name="collection">
    <choose>
      <if variable="collection-title" match="any">
        <text term="in" suffix=" "/>
        <group delimiter=", " suffix=". ">
          <text variable="collection-title"/>
          <text variable="collection-number" prefix="no. "/>
          <text variable="volume" prefix="vol. "/>
        </group>
      </if>
    </choose>
  </macro>
  <!-- Citation -->
  <citation>
    <sort>
      <key variable="citation-number"/>
    </sort>
    <layout delimiter=", ">
      <group prefix="[" suffix="]" delimiter=", ">
        <text variable="citation-number"/>
        <text macro="citation-locator"/>
      </group>
    </layout>
  </citation>
  <!-- Bibliography -->
  <bibliography entry-spacing="0" second-field-align="flush">
    <layout>
      <!-- Citation Number -->
      <text variable="citation-number" prefix="[" suffix="]"/>
      <!-- Author(s) -->
      <text macro="author" suffix=", "/>
      <!-- Rest of Citation -->
      <choose>
        <!-- Specific Formats -->
        <if type="article-journal">
          <group delimiter=", ">
            <text macro="title"/>
            <text variable="container-title" font-style="italic" form="short"/>
            <text macro="locators"/>
            <text macro="page"/>
            <text macro="issued"/>
            <text macro="status"/>
          </group>
          <choose>
            <if variable="URL DOI" match="none">
              <text value="."/>
            </if>
            <else>
              <text value=","/>
            </else>
          </choose>
          <text macro="access"/>
        </if>
        <else-if type="paper-conference speech" match="any">
          <group delimiter=", " suffix=", ">
            <text macro="title"/>
            <text macro="event"/>
            <text macro="editor"/>
          </group>
          <text macro="collection"/>
          <group delimiter=", " suffix=".">
            <text macro="publisher"/>
            <text macro="issued"/>
            <text macro="page"/>
            <text macro="status"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="chapter">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <group delimiter=" ">
              <text term="in" suffix=" "/>
              <text variable="container-title" font-style="italic"/>
            </group>
            <text macro="locators"/>
            <text macro="editor"/>
            <text macro="collection"/>
            <text macro="publisher"/>
            <text macro="issued"/>
            <group delimiter=" ">
              <label variable="chapter-number" form="short"/>
              <text variable="chapter-number"/>
            </group>
            <text macro="page"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="report">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <text macro="publisher"/>
            <group delimiter=" ">
              <text variable="genre"/>
              <text variable="number"/>
            </group>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="thesis">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <text variable="genre"/>
            <text macro="publisher"/>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="software">
          <group delimiter=". " suffix=".">
            <text macro="title"/>
            <text macro="issued" prefix="(" suffix=")"/>
            <text variable="genre"/>
            <text macro="publisher"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="article">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <text macro="issued"/>
            <group delimiter=": ">
              <text macro="publisher" font-style="italic"/>
              <text variable="number"/>
            </group>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="webpage post-weblog post" match="any">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <text variable="container-title"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="patent">
          <group delimiter=", ">
            <text macro="title"/>
            <text variable="number"/>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else-if>
        <!-- Online Video -->
        <else-if type="motion_picture">
          <text macro="geographic-location" suffix=". "/>
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="standard">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <group delimiter=" ">
              <text variable="genre"/>
              <text variable="number"/>
            </group>
            <text macro="geographic-location"/>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else-if>
        <!-- Generic/Fallback Formats -->
        <else-if type="bill book graphic legal_case legislation report song" match="any">
          <group delimiter=", " suffix=". ">
            <text macro="title"/>
            <text macro="locators"/>
          </group>
          <text macro="collection"/>
          <group delimiter=", " suffix=".">
            <text macro="publisher"/>
            <text macro="issued"/>
            <text macro="page"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else-if type="article-magazine article-newspaper broadcast interview manuscript map patent personal_communication song speech thesis webpage" match="any">
          <group delimiter=", " suffix=".">
            <text macro="title"/>
            <text variable="container-title" font-style="italic"/>
            <text macro="locators"/>
            <text macro="publisher"/>
            <text macro="page"/>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else-if>
        <else>
          <group delimiter=", " suffix=". ">
            <text macro="title"/>
            <text variable="container-title" font-style="italic"/>
            <text macro="locators"/>
          </group>
          <text macro="collection"/>
          <group delimiter=", " suffix=".">
            <text macro="publisher"/>
            <text macro="page"/>
            <text macro="issued"/>
          </group>
          <text macro="access"/>
        </else>
      </choose>
    </layout>
  </bibliography>
</style>
`;

/** chinese-gb7714-2005-numeric.csl · 源自 citation-style-language/styles（https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/chinese-gb7714-2005-numeric.csl） */
export const GBT_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" name-as-sort-order="all" sort-separator=" " demote-non-dropping-particle="never" initialize-with=" " initialize-with-hyphen="false" page-range-format="expanded" default-locale="zh-CN">
  <info>
    <title>China National Standard GB/T 7714-2005 (numeric, 中文)</title>
    <id>http://www.zotero.org/styles/chinese-gb7714-2005-numeric</id>
    <link href="http://www.zotero.org/styles/chinese-gb7714-2005-numeric" rel="self"/>
    <link href="http://www.zotero.org/styles/china-national-standard-gb-t-7714-2015-numeric" rel="template"/>
    <link href="https://std.samr.gov.cn/gb/search/gbDetailed?id=71F772D78562D3A7E05397BE0A0AB82A" rel="documentation"/>
    <author>
      <name>heromyth</name>
      <email>zxpmyth@yahoo.com.cn</email>
    </author>
    <contributor>
      <name>Zeping Lee</name>
      <email>zepinglee@gmail.com</email>
    </contributor>
    <category citation-format="numeric"/>
    <category field="generic-base"/>
    <summary>The Chinese GB/T 7714-2005 numeric style</summary>
    <updated>2024-01-22T22:56:37+08:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale xml:lang="zh">
    <date form="text">
      <date-part name="year" suffix="年" range-delimiter="&#8212;"/>
      <date-part name="month" form="numeric" suffix="月" range-delimiter="&#8212;"/>
      <date-part name="day" suffix="日" range-delimiter="&#8212;"/>
    </date>
    <terms>
      <term name="edition" form="short">版</term>
      <term name="open-quote">“</term>
      <term name="close-quote">”</term>
      <term name="open-inner-quote">‘</term>
      <term name="close-inner-quote">’</term>
    </terms>
  </locale>
  <locale>
    <date form="numeric">
      <date-part name="year" range-delimiter="/"/>
      <date-part name="month" form="numeric-leading-zeros" prefix="-" range-delimiter="/"/>
      <date-part name="day" form="numeric-leading-zeros" prefix="-" range-delimiter="/"/>
    </date>
    <terms>
      <term name="page-range-delimiter">-</term>
    </terms>
  </locale>
  <!-- 主要责任者 -->
  <macro name="author">
    <names variable="author">
      <name>
        <name-part name="family" text-case="uppercase"/>
      </name>
      <!-- <institution/> -->
      <substitute>
        <names variable="composer"/>
        <names variable="illustrator"/>
        <names variable="director"/>
        <choose>
          <if variable="container-title" match="none">
            <names variable="editor"/>
          </if>
        </choose>
      </substitute>
    </names>
  </macro>
  <!-- 题名 -->
  <macro name="title">
    <group delimiter=", ">
      <group delimiter=": ">
        <text variable="title"/>
        <group delimiter="&#8195;">
          <choose>
            <if variable="container-title" type="chapter entry-dictionary entry-encyclopedia paper-conference" match="none">
              <text macro="volume"/>
              <text variable="volume-title"/>
            </if>
          </choose>
          <group delimiter=", ">
            <choose>
              <if type="patent">
                <text macro="patent-country"/>
              </if>
            </choose>
            <choose>
              <if type="bill legal_case legislation patent regulation report standard" match="any">
                <text variable="number"/>
              </if>
            </choose>
          </group>
        </group>
      </group>
      <choose>
        <if variable="container-title" type="paper-conference" match="none">
          <choose>
            <if variable="event-date">
              <text variable="event-place"/>
              <date variable="event-date" form="text"/>
            </if>
          </choose>
        </if>
      </choose>
    </group>
    <group delimiter="/" prefix="[" suffix="]">
      <text macro="type-id"/>
      <text macro="medium-id"/>
    </group>
  </macro>
  <!-- 书籍的卷号（“第 x 卷”或“第 x 册”） -->
  <macro name="volume">
    <choose>
      <if type="article article-journal article-magazine article-newspaper periodical" match="none">
        <choose>
          <if is-numeric="volume">
            <group delimiter=" ">
              <label variable="volume" form="short" text-case="capitalize-first"/>
              <text variable="volume"/>
            </group>
          </if>
          <else>
            <text variable="volume"/>
          </else>
        </choose>
      </if>
    </choose>
  </macro>
  <!-- 专利国别 -->
  <macro name="patent-country">
    <choose>
      <!-- 专利的国别应使用 \`jurisdiction\`，但 Zotero 没有对应的字段，所以使用 \`publisher-place\` 作为备选 -->
      <if variable="jurisdiction">
        <text variable="jurisdiction"/>
      </if>
      <else>
        <text variable="publisher-place"/>
      </else>
    </choose>
  </macro>
  <!-- 文献类型标识 -->
  <macro name="type-id">
    <choose>
      <if type="article-journal article-magazine periodical" match="any">
        <text value="J"/>
      </if>
      <else-if type="article-newspaper">
        <text value="N"/>
      </else-if>
      <else-if type="book chapter classic entry-dictionary entry-encyclopedia" match="any">
        <text value="M"/>
      </else-if>
      <else-if type="dataset">
        <text value="DS"/>
      </else-if>
      <else-if type="paper-conference">
        <text value="C"/>
      </else-if>
      <else-if type="patent">
        <text value="P"/>
      </else-if>
      <else-if type="post post-weblog webpage" match="any">
        <text value="EB"/>
      </else-if>
      <else-if type="report">
        <text value="R"/>
      </else-if>
      <else-if type="software">
        <text value="CP"/>
      </else-if>
      <else-if type="standard">
        <text value="S"/>
      </else-if>
      <else-if type="thesis">
        <text value="D"/>
      </else-if>
      <else-if variable="URL">
        <text value="EB"/>
      </else-if>
      <else>
        <text value="M"/>
      </else>
    </choose>
  </macro>
  <!-- 文献载体标识 -->
  <macro name="medium-id">
    <choose>
      <if variable="medium">
        <text variable="medium"/>
      </if>
      <else-if variable="URL">
        <text value="OL"/>
      </else-if>
    </choose>
  </macro>
  <!-- 其他责任者 -->
  <macro name="secondary-contributors">
    <names variable="translator">
      <name>
        <name-part name="family" text-case="uppercase"/>
      </name>
      <!-- <institution/> -->
      <label form="short" prefix=", "/>
    </names>
  </macro>
  <!-- 专著主要责任者 -->
  <macro name="container-contributors">
    <names variable="editor">
      <name>
        <name-part name="family" text-case="uppercase"/>
      </name>
      <!-- <institution/> -->
      <substitute>
        <names variable="editorial-director"/>
        <names variable="collection-editor"/>
        <names variable="container-author"/>
      </substitute>
    </names>
  </macro>
  <!-- 专著题名 -->
  <macro name="container-booklike">
    <group delimiter=", ">
      <choose>
        <if variable="container-title">
          <!-- 优先使用专著或会议论文集的题名 -->
          <group delimiter=": ">
            <text variable="container-title"/>
            <text macro="volume"/>
          </group>
        </if>
        <else-if type="paper-conference">
          <!-- 有些会议没有论文集，使用会议名代替 -->
          <text variable="event-title"/>
        </else-if>
      </choose>
      <!-- 会议时间和会议地点 -->
      <choose>
        <if type="paper-conference" variable="event-date" match="all">
          <date variable="event-date" form="text"/>
          <text variable="event-place"/>
        </if>
      </choose>
    </group>
  </macro>
  <!-- 连续出版物中的出处项 -->
  <macro name="container-periodical">
    <choose>
      <if type="article-newspaper">
        <!-- 报纸的出处项：“刊名, 出版日期(版次): 页码[引用日期]” -->
        <group delimiter=", ">
          <text variable="container-title"/>
          <text macro="issued-date"/>
        </group>
        <text variable="page" prefix="(" suffix=")"/>
      </if>
      <else>
        <!-- 期刊、杂志的出处项：“刊名, 年, 卷(期): 页码[引用日期]” -->
        <group delimiter=": ">
          <group>
            <group delimiter=", ">
              <text variable="container-title"/>
              <text macro="issued-year"/>
              <text variable="volume"/>
            </group>
            <text variable="issue" prefix="(" suffix=")"/>
          </group>
          <text variable="page"/>
        </group>
      </else>
    </choose>
    <text macro="accessed-date"/>
  </macro>
  <!-- 版本项 -->
  <macro name="edition">
    <choose>
      <if is-numeric="edition">
        <group delimiter=" ">
          <number variable="edition" form="ordinal"/>
          <label variable="edition" form="short"/>
        </group>
      </if>
      <else>
        <text variable="edition"/>
      </else>
    </choose>
  </macro>
  <!-- 连续出版物的年卷期 -->
  <macro name="year-volume-issue">
    <group delimiter=", ">
      <text macro="issued-year"/>
      <text variable="volume"/>
    </group>
    <text variable="issue" prefix="(" suffix=")"/>
  </macro>
  <!-- 出版项 -->
  <macro name="publisher">
    <choose>
      <if type="patent">
        <!-- 专利的出版项格式“公告日期[引用日期]” -->
        <text macro="issued-date"/>
        <text macro="accessed-date"/>
      </if>
      <else-if type="book chapter paper-conference periodical thesis" variable="archive archive-place publisher publisher-place page" match="any">
        <!-- 非纯电子资源的格式“出版地: 出版者, 出版年: 页码[引用日期]” -->
        <group delimiter=": ">
          <group delimiter=", ">
            <group delimiter=": ">
              <choose>
                <if variable="publisher publisher-place" match="any">
                  <text variable="publisher-place"/>
                  <text variable="publisher"/>
                </if>
                <else>
                  <!-- 档案的馆藏地以及收藏机构或单位 -->
                  <text variable="archive-place"/>
                  <text variable="archive"/>
                </else>
              </choose>
            </group>
            <text macro="issued-year"/>
          </group>
          <text variable="page"/>
        </group>
        <text macro="accessed-date"/>
      </else-if>
      <else-if variable="URL">
        <!-- 纯电子资源联机网络文献的格式“(更新或修改日期)[引用日期]”。
          原国标中，电子公告、无出版社的报告、法规等文献都可以作为“纯电子文献”。
        -->
        <text macro="issued-date" prefix="(" suffix=")"/>
        <text macro="accessed-date"/>
      </else-if>
      <else>
        <text macro="issued-year"/>
      </else>
    </choose>
  </macro>
  <!-- 出版年 -->
  <macro name="issued-year">
    <choose>
      <if variable="issued">
        <choose>
          <if is-uncertain-date="issued">
            <!-- 出版年无法确定时, 估计的出版年应置于方括号内。 -->
            <date variable="issued" form="numeric" date-parts="year" prefix="[" suffix="]"/>
          </if>
          <else>
            <date variable="issued" form="numeric" date-parts="year"/>
          </else>
        </choose>
      </if>
      <else-if type="article-journal" variable="available-date" match="all">
        <!-- 网络首发（advance online publication）的期刊文章的日期使用 available-date -->
        <date variable="available-date" form="numeric" date-parts="year"/>
      </else-if>
      <else>
        <!-- 选取引用日期的年份作为估计的出版年 -->
        <date variable="accessed" form="numeric" date-parts="year" prefix="[" suffix="]"/>
      </else>
    </choose>
  </macro>
  <!-- 出版日期，用于报纸文献、专利的“公告日期或公开日期”、电子资源的“更新或修改日期” -->
  <macro name="issued-date">
    <date variable="issued" form="numeric"/>
  </macro>
  <!-- 引用日期 -->
  <macro name="accessed-date">
    <choose>
      <if variable="URL">
        <date variable="accessed" form="numeric" prefix="[" suffix="]"/>
      </if>
    </choose>
  </macro>
  <!-- 获取和访问路径、数字对象唯一标识符 -->
  <macro name="access">
    <text variable="URL"/>
  </macro>
  <!-- 参考文献表格式 -->
  <macro name="entry-layout">
    <group delimiter=". ">
      <text macro="author"/>
      <choose>
        <if type="periodical">
          <!-- 4.3 连续出版物 -->
          <text macro="title"/>
          <text macro="year-volume-issue"/>
          <text macro="publisher"/>
        </if>
        <else-if type="article-journal article-magazine article-newspaper" match="any">
          <!-- 4.4 连续出版物中的析出文献 -->
          <text macro="title"/>
          <text macro="container-periodical"/>
        </else-if>
        <else-if type="patent">
          <!-- 4.5 专利文献 -->
          <text macro="title"/>
          <text macro="publisher"/>
        </else-if>
        <else-if type="dataset post post-weblog software webpage" match="any">
          <!-- 4.6 电子资源 -->
          <text macro="title"/>
          <text macro="publisher"/>
        </else-if>
        <else-if type="chapter entry-dictionary entry-encyclopedia paper-conference" variable="container-title" match="any">
          <!-- 4.2 专著中的析出文献 -->
          <group delimiter="//">
            <group delimiter=". ">
              <text macro="title"/>
              <text macro="secondary-contributors"/>
            </group>
            <group delimiter=". ">
              <text macro="container-contributors"/>
              <text macro="container-booklike"/>
            </group>
          </group>
          <text macro="edition"/>
          <text macro="publisher"/>
        </else-if>
        <else>
          <!-- 4.1 专著 -->
          <text macro="title"/>
          <text macro="secondary-contributors"/>
          <text macro="edition"/>
          <text macro="publisher"/>
        </else>
      </choose>
      <text macro="access"/>
    </group>
  </macro>
  <citation collapse="citation-number" after-collapse-delimiter=",">
    <sort>
      <key variable="citation-number"/>
    </sort>
    <layout vertical-align="sup" delimiter="," prefix="[" suffix="]">
      <text variable="citation-number"/>
    </layout>
  </citation>
  <bibliography entry-spacing="0" et-al-min="4" et-al-use-first="3" second-field-align="flush">
    <!-- 取消这部分注释可以开启 CSL-M 的多语言功能：按照文献的语言输出“et al.”等术语 -->
    <!-- <layout suffix="." locale="en"><text variable="citation-number" prefix="[" suffix="]"/><text macro="entry-layout"/></layout>
    -->
    <layout suffix=".">
      <text variable="citation-number" prefix="[" suffix="]"/>
      <text macro="entry-layout"/>
    </layout>
  </bibliography>
</style>
`;

/** nature.csl · 源自 citation-style-language/styles（https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/nature.csl） */
export const NATURE_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" demote-non-dropping-particle="sort-only" default-locale="en-GB">
  <info>
    <title>Nature</title>
    <id>http://www.zotero.org/styles/nature</id>
    <link href="http://www.zotero.org/styles/nature" rel="self"/>
    <link href="https://www.nature.com/nature/for-authors/formatting-guide" rel="documentation"/>
    <author>
      <name>Michael Berkowitz</name>
      <email>mberkowi@gmu.edu</email>
    </author>
    <contributor>
      <name>Patrick O'Brien</name>
      <email>citationstyler@gmail.com</email>
    </contributor>
    <category citation-format="numeric"/>
    <category field="science"/>
    <category field="generic-base"/>
    <issn>0028-0836</issn>
    <eissn>1476-4687</eissn>
    <updated>2025-09-10T18:26:21+00:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <macro name="title">
    <choose>
      <if type="bill book graphic legal_case legislation motion_picture report song" match="any">
        <text variable="title" font-style="italic" text-case="title"/>
      </if>
      <else>
        <text variable="title"/>
      </else>
    </choose>
  </macro>
  <macro name="author">
    <names variable="author">
      <name sort-separator=", " delimiter=", " and="symbol" initialize-with=". " delimiter-precedes-last="never" name-as-sort-order="all"/>
      <label form="short" prefix=", "/>
      <et-al font-style="italic"/>
    </names>
  </macro>
  <macro name="access">
    <choose>
      <if variable="volume" type="article dataset software" match="any"/>
      <else-if variable="DOI">
        <text variable="DOI" prefix="doi:"/>
      </else-if>
    </choose>
  </macro>
  <macro name="access-data">
    <choose>
      <if type="dataset software" match="any">
        <text variable="DOI" prefix="https://doi.org/"/>
      </if>
    </choose>
  </macro>
  <macro name="issuance">
    <choose>
      <if type="bill book graphic legal_case legislation motion_picture song thesis chapter paper-conference" match="any">
        <group delimiter="; " suffix=".">
          <group delimiter=", " prefix="(" suffix=")">
            <text variable="publisher" form="long"/>
            <text variable="publisher-place"/>
            <date variable="issued">
              <date-part name="year"/>
            </date>
          </group>
        </group>
      </if>
      <else-if type="article">
        <group delimiter=" ">
          <choose>
            <if variable="genre" match="any">
              <text variable="genre" text-case="capitalize-first"/>
            </if>
            <else>
              <text term="preprint" text-case="capitalize-first"/>
            </else>
          </choose>
          <text term="at"/>
          <choose>
            <if variable="DOI" match="any">
              <text variable="DOI" prefix="https://doi.org/"/>
            </if>
            <else>
              <text variable="URL"/>
            </else>
          </choose>
          <date date-parts="year" form="text" variable="issued" prefix="(" suffix=")"/>
        </group>
      </else-if>
      <else-if type="dataset software" match="any">
        <group delimiter=" ">
          <text variable="publisher"/>
          <text macro="access-data"/>
          <date date-parts="year" form="text" variable="issued" prefix="(" suffix=")"/>
        </group>
      </else-if>
      <else-if type="report webpage post post-weblog" match="any">
        <group delimiter=" ">
          <text variable="URL"/>
          <date date-parts="year" form="text" variable="issued" prefix="(" suffix=")"/>
        </group>
      </else-if>
      <else-if type="article-journal" match="any">
        <group delimiter=" ">
          <choose>
            <if match="none" variable="volume page">
              <choose>
                <if match="any" variable="DOI">
                  <text variable="DOI" prefix="https://doi.org/"/>
                </if>
                <else>
                  <text variable="URL"/>
                </else>
              </choose>
            </if>
          </choose>
          <date date-parts="year" form="text" variable="issued" prefix="(" suffix=")"/>
        </group>
      </else-if>
      <else>
        <date variable="issued" prefix="(" suffix=")">
          <date-part name="year"/>
        </date>
      </else>
    </choose>
  </macro>
  <macro name="container-title">
    <choose>
      <if type="article-journal">
        <text variable="container-title" font-style="italic" form="short"/>
      </if>
      <else>
        <text variable="container-title" font-style="italic"/>
      </else>
    </choose>
  </macro>
  <macro name="editor">
    <choose>
      <if type="chapter paper-conference" match="any">
        <names variable="editor" prefix="(" suffix=")">
          <label form="short" suffix=" "/>
          <name and="symbol" delimiter-precedes-last="never" initialize-with=". " name-as-sort-order="all"/>
        </names>
      </if>
    </choose>
  </macro>
  <macro name="volume">
    <choose>
      <if type="article-journal" match="any">
        <text variable="volume" font-weight="bold" suffix=","/>
      </if>
      <else>
        <group delimiter=" ">
          <label variable="volume" form="short"/>
          <text variable="volume"/>
        </group>
      </else>
    </choose>
  </macro>
  <citation collapse="citation-number">
    <sort>
      <key variable="citation-number"/>
    </sort>
    <layout vertical-align="sup" delimiter=",">
      <text variable="citation-number"/>
    </layout>
  </citation>
  <bibliography et-al-min="6" et-al-use-first="1" second-field-align="flush" entry-spacing="0" line-spacing="2">
    <layout suffix=".">
      <text variable="citation-number" suffix="."/>
      <group delimiter=" ">
        <text macro="author" suffix="."/>
        <text macro="title" suffix="."/>
        <choose>
          <if type="chapter paper-conference" match="any">
            <text term="in"/>
          </if>
        </choose>
        <text macro="container-title"/>
        <text macro="editor"/>
        <text macro="volume"/>
        <text variable="page"/>
        <text macro="issuance"/>
        <text macro="access"/>
      </group>
    </layout>
  </bibliography>
</style>
`;

/** chicago-author-date-16th-edition.csl · 源自 citation-style-language/styles（https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/chicago-author-date-16th-edition.csl） */
export const CHICAGO_AUTHOR_DATE_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style class="in-text" demote-non-dropping-particle="display-and-sort" page-range-format="chicago" version="1.0" xmlns="http://purl.org/net/xbiblio/csl">
  <info>
    <title>Chicago Manual of Style 16th edition (author-date)</title>
    <id>http://www.zotero.org/styles/chicago-author-date-16th-edition</id>
    <link href="http://www.zotero.org/styles/chicago-author-date-16th-edition" rel="self"/>
    <link href="https://web.archive.org/web/20160830192245/http://www.chicagomanualofstyle.org/tools_citationguide.html" rel="documentation"/>
    <author>
      <name>Julian Onions</name>
      <uri>https://orcid.org/0000-0001-5192-6856</uri>
    </author>
    <contributor>
      <name>Sebastian Karcher</name>
      <uri>https://orcid.org/0000-0001-8249-7388</uri>
    </contributor>
    <contributor>
      <name>Richard Karnesky</name>
      <uri>https://orcid.org/0000-0003-4717-457X</uri>
    </contributor>
    <contributor>
      <name>Andrew Dunning</name>
      <uri>https://orcid.org/0000-0003-0464-5036</uri>
    </contributor>
    <contributor>
      <name>Brenton M. Wiernik</name>
      <uri>https://orcid.org/0000-0001-9560-6336</uri>
    </contributor>
    <category citation-format="author-date"/>
    <category field="generic-base"/>
    <summary>The author-date variant of the Chicago style</summary>
    <updated>2017-10-12T12:00:00+00:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale xml:lang="en">
    <terms>
      <term form="verb-short" name="editor">ed.</term>
      <term form="verb" name="container-author">by</term>
      <term form="verb-short" name="translator">trans.</term>
      <term form="verb" name="editortranslator">edited and translated by</term>
      <term form="short" name="translator">trans.</term>
    </terms>
  </locale>
  <macro name="secondary-contributors">
    <choose>
      <if match="none" type="chapter entry-dictionary entry-encyclopedia paper-conference">
        <group delimiter=". ">
          <names delimiter=". " variable="editor translator">
            <label form="verb" suffix=" " text-case="capitalize-first"/>
            <name and="text" delimiter=", "/>
          </names>
          <names delimiter=". " variable="director">
            <label form="verb" suffix=" " text-case="capitalize-first"/>
            <name and="text" delimiter=", "/>
          </names>
        </group>
      </if>
    </choose>
  </macro>
  <macro name="container-contributors">
    <choose>
      <if match="any" type="chapter entry-dictionary entry-encyclopedia paper-conference">
        <group delimiter=", " prefix=", ">
          <names delimiter=", " variable="container-author">
            <label form="verb" suffix=" "/>
            <name and="text" delimiter=", "/>
          </names>
          <names delimiter=", " variable="editor translator">
            <label form="verb" suffix=" "/>
            <name and="text" delimiter=", "/>
          </names>
        </group>
      </if>
    </choose>
  </macro>
  <macro name="recipient">
    <choose>
      <if type="personal_communication">
        <choose>
          <if variable="genre">
            <text text-case="capitalize-first" variable="genre"/>
          </if>
          <else>
            <text term="letter" text-case="capitalize-first"/>
          </else>
        </choose>
      </if>
    </choose>
    <names delimiter=", " variable="recipient">
      <label form="verb" prefix=" " suffix=" " text-case="lowercase"/>
      <name and="text" delimiter=", "/>
    </names>
  </macro>
  <macro name="substitute-title">
    <choose>
      <if match="any" type="article-magazine article-newspaper review review-book">
        <text macro="container-title"/>
      </if>
    </choose>
  </macro>
  <macro name="contributors">
    <group delimiter=". ">
      <names variable="author">
        <name and="text" delimiter=", " delimiter-precedes-last="always" name-as-sort-order="first" sort-separator=", "/>
        <label form="short" prefix=", "/>
        <substitute>
          <names variable="editor"/>
          <names variable="translator"/>
          <names variable="director"/>
          <text macro="substitute-title"/>
          <text macro="title"/>
        </substitute>
      </names>
      <text macro="recipient"/>
    </group>
  </macro>
  <macro name="contributors-short">
    <names variable="author">
      <name and="text" delimiter=", " form="short" initialize-with=". "/>
      <substitute>
        <names variable="editor"/>
        <names variable="translator"/>
        <names variable="director"/>
        <text macro="substitute-title"/>
        <text macro="title"/>
      </substitute>
    </names>
  </macro>
  <macro name="interviewer">
    <names delimiter=", " variable="interviewer">
      <label form="verb" prefix=" " suffix=" " text-case="capitalize-first"/>
      <name and="text" delimiter=", "/>
    </names>
  </macro>
  <macro name="archive">
    <group delimiter=". ">
      <text text-case="capitalize-first" variable="archive_location"/>
      <text variable="archive"/>
      <text variable="archive-place"/>
    </group>
  </macro>
  <macro name="access">
    <group delimiter=". ">
      <choose>
        <if match="any" type="graphic report">
          <text macro="archive"/>
        </if>
        <else-if match="none" type="article-journal bill book chapter legal_case legislation motion_picture paper-conference">
          <text macro="archive"/>
        </else-if>
      </choose>
      <choose>
        <if match="any" type="webpage post-weblog">
          <date delimiter=" " variable="issued">
            <date-part name="month"/>
            <date-part name="day"/>
          </date>
        </if>
      </choose>
      <choose>
        <if match="none" variable="issued">
          <group delimiter=" ">
            <text term="accessed" text-case="capitalize-first"/>
            <date delimiter=" " variable="accessed">
              <date-part name="month"/>
              <date-part name="day"/>
            </date>
          </group>
        </if>
      </choose>
      <choose>
        <if match="none" type="legal_case">
          <choose>
            <if variable="DOI">
              <text prefix="doi:" variable="DOI"/>
            </if>
            <else>
              <text variable="URL"/>
            </else>
          </choose>
        </if>
      </choose>
    </group>
  </macro>
  <macro name="title">
    <choose>
      <if match="none" variable="title">
        <choose>
          <if match="none" type="personal_communication">
            <text text-case="capitalize-first" variable="genre"/>
          </if>
        </choose>
      </if>
      <else-if match="any" type="bill book graphic legislation motion_picture report song">
        <text font-style="italic" text-case="title" variable="title"/>
        <group delimiter=" " prefix=" (" suffix=")">
          <label variable="version"/>
          <text variable="version"/>
        </group>
      </else-if>
      <else-if variable="reviewed-author">
        <choose>
          <if variable="reviewed-title">
            <group delimiter=". ">
              <text quotes="true" text-case="title" variable="title"/>
              <group delimiter=", ">
                <text font-style="italic" prefix="Review of " text-case="title" variable="reviewed-title"/>
                <names variable="reviewed-author">
                  <label form="verb-short" suffix=" " text-case="lowercase"/>
                  <name and="text" delimiter=", "/>
                </names>
              </group>
            </group>
          </if>
          <else>
            <group delimiter=", ">
              <text font-style="italic" prefix="Review of " text-case="title" variable="title"/>
              <names variable="reviewed-author">
                <label form="verb-short" suffix=" " text-case="lowercase"/>
                <name and="text" delimiter=", "/>
              </names>
            </group>
          </else>
        </choose>
      </else-if>
      <else-if match="any" type="legal_case interview patent">
        <text variable="title"/>
      </else-if>
      <else>
        <text quotes="true" text-case="title" variable="title"/>
      </else>
    </choose>
  </macro>
  <macro name="edition">
    <choose>
      <if match="any" type="bill book graphic legal_case legislation motion_picture report song">
        <choose>
          <if is-numeric="edition">
            <group delimiter=" " prefix=". ">
              <number form="ordinal" variable="edition"/>
              <text form="short" strip-periods="true" term="edition"/>
            </group>
          </if>
          <else>
            <text prefix=". " text-case="capitalize-first" variable="edition"/>
          </else>
        </choose>
      </if>
      <else-if match="any" type="chapter entry-dictionary entry-encyclopedia paper-conference">
        <choose>
          <if is-numeric="edition">
            <group delimiter=" " prefix=", ">
              <number form="ordinal" variable="edition"/>
              <label form="short" variable="edition"/>
            </group>
          </if>
          <else>
            <text prefix=", " variable="edition"/>
          </else>
        </choose>
      </else-if>
    </choose>
  </macro>
  <macro name="locators">
    <choose>
      <if type="article-journal">
        <choose>
          <if variable="volume">
            <text prefix=" " variable="volume"/>
            <group prefix=" (" suffix=")">
              <choose>
                <if variable="issue">
                  <text variable="issue"/>
                </if>
                <else>
                  <date variable="issued">
                    <date-part name="month"/>
                  </date>
                </else>
              </choose>
            </group>
          </if>
          <else-if variable="issue">
            <group delimiter=" " prefix=", ">
              <label form="short" variable="issue"/>
              <text variable="issue"/>
              <date prefix="(" suffix=")" variable="issued">
                <date-part name="month"/>
              </date>
            </group>
          </else-if>
          <else>
            <date prefix=", " variable="issued">
              <date-part name="month"/>
            </date>
          </else>
        </choose>
      </if>
      <else-if type="legal_case">
        <text prefix=", " variable="volume"/>
        <text prefix=" " variable="container-title"/>
        <text prefix=" " variable="page"/>
      </else-if>
      <else-if match="any" type="bill book graphic legal_case legislation motion_picture report song">
        <group delimiter=". " prefix=". ">
          <group>
            <text form="short" suffix=" " term="volume" text-case="capitalize-first"/>
            <number form="numeric" variable="volume"/>
          </group>
          <group>
            <number form="numeric" variable="number-of-volumes"/>
            <text form="short" plural="true" prefix=" " term="volume"/>
          </group>
        </group>
      </else-if>
      <else-if match="any" type="chapter entry-dictionary entry-encyclopedia paper-conference">
        <choose>
          <if match="none" variable="page">
            <group prefix=". ">
              <text form="short" suffix=" " term="volume" text-case="capitalize-first"/>
              <number form="numeric" variable="volume"/>
            </group>
          </if>
        </choose>
      </else-if>
    </choose>
  </macro>
  <macro name="locators-chapter">
    <choose>
      <if match="any" type="chapter entry-dictionary entry-encyclopedia paper-conference">
        <choose>
          <if variable="page">
            <group prefix=", ">
              <text suffix=":" variable="volume"/>
              <text variable="page"/>
            </group>
          </if>
        </choose>
      </if>
    </choose>
  </macro>
  <macro name="locators-article">
    <choose>
      <if type="article-newspaper">
        <group delimiter=", " prefix=", ">
          <group delimiter=" ">
            <text variable="edition"/>
            <label variable="edition"/>
          </group>
          <group>
            <text form="short" suffix=" " term="section"/>
            <text variable="section"/>
          </group>
        </group>
      </if>
      <else-if type="article-journal">
        <choose>
          <if match="any" variable="volume issue">
            <text prefix=": " variable="page"/>
          </if>
          <else>
            <text prefix=", " variable="page"/>
          </else>
        </choose>
      </else-if>
    </choose>
  </macro>
  <macro name="point-locators">
    <choose>
      <if variable="locator">
        <choose>
          <if locator="page" match="none">
            <choose>
              <if match="any" type="bill book graphic legal_case legislation motion_picture report song">
                <choose>
                  <if variable="volume">
                    <group>
                      <text form="short" suffix=" " term="volume"/>
                      <number form="numeric" variable="volume"/>
                      <label form="short" prefix=", " suffix=" " variable="locator"/>
                    </group>
                  </if>
                  <else>
                    <label form="short" suffix=" " variable="locator"/>
                  </else>
                </choose>
              </if>
              <else>
                <label form="short" suffix=" " variable="locator"/>
              </else>
            </choose>
          </if>
          <else-if match="any" type="bill book graphic legal_case legislation motion_picture report song">
            <number form="numeric" suffix=":" variable="volume"/>
          </else-if>
        </choose>
        <text variable="locator"/>
      </if>
    </choose>
  </macro>
  <macro name="container-prefix">
    <text term="in" text-case="capitalize-first"/>
  </macro>
  <macro name="container-title">
    <choose>
      <if match="any" type="chapter entry-dictionary entry-encyclopedia paper-conference">
        <text macro="container-prefix" suffix=" "/>
      </if>
    </choose>
    <choose>
      <if match="none" type="legal_case">
        <text font-style="italic" text-case="title" variable="container-title"/>
      </if>
    </choose>
  </macro>
  <macro name="publisher">
    <group delimiter=": ">
      <text variable="publisher-place"/>
      <text variable="publisher"/>
    </group>
  </macro>
  <macro name="date">
    <choose>
      <if variable="issued">
        <group delimiter=" ">
          <date date-parts="year" form="text" prefix="(" suffix=")" variable="original-date"/>
          <date variable="issued">
            <date-part name="year"/>
          </date>
        </group>
      </if>
      <else-if variable="accessed">
        <date variable="accessed">
          <date-part name="year"/>
        </date>
      </else-if>
      <else-if variable="status">
        <text text-case="capitalize-first" variable="status"/>
      </else-if>
      <else>
        <text form="short" term="no date"/>
      </else>
    </choose>
  </macro>
  <macro name="date-in-text">
    <choose>
      <if variable="issued">
        <group delimiter=" ">
          <date date-parts="year" form="text" prefix="[" suffix="]" variable="original-date"/>
          <date variable="issued">
            <date-part name="year"/>
          </date>
        </group>
      </if>
      <else-if variable="accessed">
        <date variable="accessed">
          <date-part name="year"/>
        </date>
      </else-if>
      <else-if variable="status">
        <text variable="status"/>
      </else-if>
      <else>
        <text form="short" term="no date"/>
      </else>
    </choose>
  </macro>
  <macro name="day-month">
    <date variable="issued">
      <date-part name="month"/>
      <date-part name="day" prefix=" "/>
    </date>
  </macro>
  <macro name="collection-title">
    <choose>
      <if match="none" type="article-journal">
        <choose>
          <if is-numeric="collection-number" match="none">
            <group delimiter=", ">
              <text text-case="title" variable="collection-title"/>
              <text variable="collection-number"/>
            </group>
          </if>
          <else>
            <group delimiter=" ">
              <text text-case="title" variable="collection-title"/>
              <text variable="collection-number"/>
            </group>
          </else>
        </choose>
      </if>
    </choose>
  </macro>
  <macro name="collection-title-journal">
    <choose>
      <if type="article-journal">
        <group delimiter=" ">
          <text variable="collection-title"/>
          <text variable="collection-number"/>
        </group>
      </if>
    </choose>
  </macro>
  <macro name="event">
    <group delimiter=" ">
      <choose>
        <if variable="genre">
          <text term="presented at"/>
        </if>
        <else>
          <text term="presented at" text-case="capitalize-first"/>
        </else>
      </choose>
      <text variable="event"/>
    </group>
  </macro>
  <macro name="description">
    <choose>
      <if type="interview">
        <group delimiter=". ">
          <text macro="interviewer"/>
          <text text-case="capitalize-first" variable="medium"/>
        </group>
      </if>
      <else-if type="patent">
        <group delimiter=" " prefix=". ">
          <text variable="authority"/>
          <text variable="number"/>
        </group>
      </else-if>
      <else>
        <text prefix=". " text-case="capitalize-first" variable="medium"/>
      </else>
    </choose>
    <choose>
      <if match="none" variable="title"/>
      <else-if match="any" type="thesis personal_communication speech"/>
      <else>
        <group delimiter=" " prefix=". ">
          <text text-case="capitalize-first" variable="genre"/>
          <choose>
            <if type="report">
              <text variable="number"/>
            </if>
          </choose>
        </group>
      </else>
    </choose>
  </macro>
  <macro name="issue">
    <choose>
      <if type="legal_case">
        <text prefix=". " variable="authority"/>
      </if>
      <else-if type="speech">
        <group delimiter=", " prefix=". ">
          <group delimiter=" ">
            <text text-case="capitalize-first" variable="genre"/>
            <text macro="event"/>
          </group>
          <text variable="event-place"/>
          <text macro="day-month"/>
        </group>
      </else-if>
      <else-if match="any" type="article-newspaper article-magazine personal_communication">
        <text macro="day-month" prefix=", "/>
      </else-if>
      <else-if type="patent">
        <group delimiter=", " prefix=", ">
          <group delimiter=" ">
            <!--Needs Localization-->
            <text value="filed"/>
            <date form="text" variable="submitted"/>
          </group>
          <group delimiter=" ">
            <choose>
              <if variable="issued submitted">
                <text term="and"/>
              </if>
            </choose>
            <!--Needs Localization-->
            <text value="issued"/>
            <date form="text" variable="issued"/>
          </group>
        </group>
      </else-if>
      <else>
        <group delimiter=", " prefix=". ">
          <choose>
            <if type="thesis">
              <text text-case="capitalize-first" variable="genre"/>
            </if>
          </choose>
          <text macro="publisher"/>
        </group>
      </else>
    </choose>
  </macro>
  <citation collapse="year" disambiguate-add-givenname="true" disambiguate-add-names="true" disambiguate-add-year-suffix="true" et-al-min="4" et-al-use-first="1" givenname-disambiguation-rule="primary-name">
    <layout delimiter="; " prefix="(" suffix=")">
      <group delimiter=", ">
        <choose>
          <if match="any" variable="issued accessed">
            <group delimiter=" ">
              <text macro="contributors-short"/>
              <text macro="date-in-text"/>
            </group>
          </if>
          <!---comma before forthcoming and n.d.-->
          <else>
            <group delimiter=", ">
              <text macro="contributors-short"/>
              <text macro="date-in-text"/>
            </group>
          </else>
        </choose>
        <text macro="point-locators"/>
      </group>
    </layout>
  </citation>
  <bibliography entry-spacing="0" et-al-min="11" et-al-use-first="7" hanging-indent="true" subsequent-author-substitute="&#8212;&#8212;&#8212;">
    <sort>
      <key macro="contributors"/>
      <key variable="issued"/>
      <key variable="title"/>
    </sort>
    <layout suffix=".">
      <group delimiter=". ">
        <text macro="contributors"/>
        <text macro="date"/>
        <text macro="title"/>
      </group>
      <text macro="description"/>
      <text macro="secondary-contributors" prefix=". "/>
      <text macro="container-title" prefix=". "/>
      <text macro="container-contributors"/>
      <text macro="edition"/>
      <text macro="locators-chapter"/>
      <text macro="collection-title-journal" prefix=", " suffix=", "/>
      <text macro="locators"/>
      <text macro="collection-title" prefix=". "/>
      <text macro="issue"/>
      <text macro="locators-article"/>
      <text macro="access" prefix=". "/>
    </layout>
  </bibliography>
</style>
`;

/** springer-basic-author-date.csl · 源自 citation-style-language/styles（https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/springer-basic-author-date.csl） */
export const SPRINGER_BASIC_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" demote-non-dropping-particle="never" default-locale="en-US">
  <info>
    <title>Springer - Basic (author-date)</title>
    <id>http://www.zotero.org/styles/springer-basic-author-date</id>
    <link href="http://www.zotero.org/styles/springer-basic-author-date" rel="self"/>
    <link href="http://www.springer.com/cda/content/document/cda_downloaddocument/instruct-authors-e.pdf" rel="documentation"/>
    <link href="http://www.springer.com/cda/content/document/cda_downloaddocument/manuscript-guidelines-1.0.pdf" rel="documentation"/>
    <!-- This style corresponds to 'Springer Basic' in the pdf document 'Key Style Points' at this url -->
    <link href="http://www.springer.com/cda/content/document/cda_downloaddocument/Key_Style_Points_1.0.pdf" rel="documentation"/>
    <author>
      <name>Jens Allmer</name>
      <email>jens@allmer.de</email>
      <uri>http://jens.allmer.de</uri>
    </author>
    <contributor>
      <name>Sebastian Karcher</name>
    </contributor>
    <category citation-format="author-date"/>
    <summary>Springer Author Date Style for the disciplines Medicine, Biomedicine, Life Sciences, Chemistry, Geosciences, Computer Science, Engineering, Economics. This style is based on Harvard style and recommendations of the Council of Biology Editors.</summary>
    <updated>2019-09-25T12:00:00+00:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale>
    <terms>
      <term name="and others">et al</term>
      <term name="et-al">et al.</term>
      <term name="edition" form="short">edn.</term>
    </terms>
  </locale>
  <macro name="author-short">
    <names variable="author">
      <name form="short" and="text"/>
      <et-al/>
      <substitute>
        <names variable="editor"/>
        <names variable="translator"/>
      </substitute>
    </names>
  </macro>
  <macro name="author">
    <names variable="author">
      <name sort-separator=" " initialize-with="" name-as-sort-order="all" delimiter=", " delimiter-precedes-last="always"/>
      <label form="short" strip-periods="true" prefix=" (" suffix=")"/>
      <et-al term="and others"/>
      <substitute>
        <names variable="editor"/>
        <names variable="translator"/>
      </substitute>
    </names>
  </macro>
  <macro name="edition">
    <choose>
      <if is-numeric="edition">
        <group delimiter=" ">
          <number variable="edition" form="ordinal"/>
          <text term="edition" form="short"/>
        </group>
      </if>
      <else>
        <text variable="edition"/>
      </else>
    </choose>
  </macro>
  <macro name="year">
    <date variable="issued">
      <date-part name="year"/>
    </date>
  </macro>
  <macro name="title">
    <choose>
      <if type="book">
        <group delimiter=". ">
          <group delimiter=", ">
            <text variable="title"/>
            <text macro="edition"/>
          </group>
          <choose>
            <!-- Replace with type="software" as that becomes available -->
            <if type="book" match="any" variable="version">
              <text variable="version" prefix="Version "/>
            </if>
          </choose>
        </group>
      </if>
      <else>
        <text variable="title"/>
      </else>
    </choose>
  </macro>
  <macro name="year-parenth">
    <date prefix="(" suffix=")" variable="issued">
      <date-part name="year"/>
    </date>
  </macro>
  <citation et-al-min="3" et-al-use-first="1" disambiguate-add-year-suffix="true" collapse="year-suffix" cite-group-delimiter=", ">
    <sort>
      <key variable="issued"/>
      <key macro="author"/>
    </sort>
    <layout prefix="(" suffix=")" delimiter="; ">
      <group delimiter=", ">
        <group delimiter=" ">
          <text macro="author-short"/>
          <text macro="year"/>
        </group>
        <group delimiter=" ">
          <label variable="locator" form="short"/>
          <text variable="locator"/>
        </group>
      </group>
    </layout>
  </citation>
  <bibliography et-al-min="5" et-al-use-first="3" hanging-indent="true">
    <sort>
      <key macro="author"/>
      <key variable="author" sort="ascending"/>
    </sort>
    <layout>
      <group delimiter=" ">
        <text macro="author"/>
        <text macro="year-parenth"/>
        <text macro="title"/>
      </group>
      <choose>
        <!--    Book chapter
             Brown B, Aaron M (2001) The politics of nature.
             In: Smith J (ed) The rise of modern genomics, 3rd edn.
             Wiley, New York, pp 230-257 -->
        <if type="chapter paper-conference" match="any">
          <group delimiter=" " prefix=". ">
            <text term="in" text-case="capitalize-first" suffix=":"/>
            <names variable="editor">
              <name sort-separator=" " initialize-with="" name-as-sort-order="all" delimiter=", " delimiter-precedes-last="always"/>
              <label form="short" strip-periods="true" prefix=" (" suffix=")"/>
            </names>
            <group delimiter=", ">
              <text variable="container-title"/>
              <text macro="edition"/>
            </group>
          </group>
          <group prefix=". " delimiter=", ">
            <text variable="publisher"/>
            <text variable="publisher-place"/>
            <group delimiter=" ">
              <label variable="page" form="short" strip-periods="true"/>
              <text variable="page"/>
            </group>
          </group>
        </if>
        <else-if type="article-journal">
          <choose>
            <if variable="page volume" match="any">
              <!--    Journal article
                   Gamelin FX, Baquet G, Berthoin S, Thevenet D, Nourry C, Nottin S, Bosquet L (2009)
                   Effect of high intensity intermittent training on heart rate variability in prepubescent children.
                   Eur J Appl Physiol 105:731-738. doi: 10.1007/s00421-008-0955-8
                   Ideally, the names of all authors should be provided, but the usage of "et al"
                   in long author lists will also be accepted:
                   Smith J, Jones M Jr, Houghton L et al (1999)
                   Future of health insurance. N Engl J Med 965:325-329   -->
              <group prefix=". " delimiter=". ">
                <group delimiter=" ">
                  <text variable="container-title" form="short" strip-periods="true"/>
                  <group delimiter=":">
                    <text variable="volume" suffix=":"/>
                    <text variable="page"/>
                  </group>
                </group>
                <text prefix="https://doi.org/" variable="DOI"/>
              </group>
            </if>
            <else>
              <!--    Article by DOI
       Slifka MK, Whitton JL (2000) Clinical implications of dysregulated cytokine production.
       J Mol Med. doi:10.1007/s001090000086     -->
              <group prefix=". " delimiter=". ">
                <text variable="container-title" form="short" strip-periods="true"/>
                <text prefix="https://doi.org/" variable="DOI"/>
              </group>
            </else>
          </choose>
        </else-if>
        <else-if type="bill book graphic legal_case legislation motion_picture report song" match="any">
          <!--    Book
               South J, Blass B (2001) The future of modern genomics. Blackwell, London    -->
          <group delimiter=". ">
            <group prefix=". " delimiter=", ">
              <text variable="publisher"/>
              <text variable="publisher-place"/>
            </group>
            <group>
              <choose>
                <if match="any" variable="version">
                  <text variable="URL" prefix="URL "/>
                </if>
              </choose>
            </group>
          </group>
        </else-if>
        <else-if type="webpage post-weblog post" match="any">
          <!--    Online document
               Doe J (1999) Title of subordinate document. In: The dictionary of substances and their effects.
               Royal Society of Chemistry. Available via DIALOG.
               http://www.rsc.org/dose/title of subordinate document. Accessed 15 Jan 1999
               Unfortunately, "Royal Society of Chemistry. Available via DIALOG." cannot seem to be mapped here -->
          <group prefix=". " delimiter=". ">
            <text prefix="In: " variable="container-title" form="short"/>
            <text variable="URL"/>
            <date variable="accessed">
              <date-part prefix="Accessed " name="day" suffix=" "/>
              <date-part name="month" form="short" suffix=" " strip-periods="true"/>
              <date-part name="year"/>
            </date>
          </group>
        </else-if>
        <else-if type="thesis">
          <!--    Dissertation
               Trent JW (1975) Experimental acute renal failure. Dissertation, University of California       -->
          <group prefix=". " delimiter=", ">
            <text variable="genre" text-case="capitalize-first"/>
            <text variable="publisher"/>
          </group>
        </else-if>
        <else>
          <!--    None of the provided formats need to add manually (some data provided) -->
          <group prefix=". " delimiter=" ">
            <text variable="container-title" form="short"/>
            <group delimiter=":">
              <text variable="volume"/>
              <text variable="page"/>
            </group>
          </group>
        </else>
      </choose>
    </layout>
  </bibliography>
</style>
`;

/** american-chemical-society.csl · 源自 citation-style-language/styles（https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/american-chemical-society.csl） */
export const ACS_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" demote-non-dropping-particle="sort-only" page-range-format="expanded" default-locale="en-US">
  <info>
    <title>ACS Guide 2026 revision</title>
    <title-short>American Chemical Society</title-short>
    <id>http://www.zotero.org/styles/american-chemical-society</id>
    <link href="http://www.zotero.org/styles/american-chemical-society" rel="self"/>
    <link href="https://doi.org/10.1021/acsguide.40303" rel="documentation"/>
    <link href="https://doi.org/10.1021/acsguide" rel="documentation"/>
    <author>
      <name>Julian Onions</name>
      <email>julian.onions@gmail.com</email>
    </author>
    <contributor>
      <name>Ivan Bushmarinov</name>
      <email>ib@ineos.ac.ru</email>
    </contributor>
    <contributor>
      <name>Sebastian Karcher</name>
    </contributor>
    <contributor>
      <name>Patrick O'Brien</name>
    </contributor>
    <category citation-format="numeric"/>
    <category field="chemistry"/>
    <summary>The American Chemical Society style</summary>
    <updated>2026-08-25T12:37:10+00:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale xml:lang="en">
    <terms>
      <term name="editortranslator" form="short">
        <single>ed. and translator</single>
        <multiple>eds. and translators</multiple>
      </term>
      <term name="translator" form="short">
        <single>translator</single>
        <multiple>translators</multiple>
      </term>
      <term name="collection-editor" form="short">
        <single>series ed.</single>
        <multiple>series eds.</multiple>
      </term>
    </terms>
  </locale>
  <macro name="editor">
    <group delimiter="; ">
      <names variable="editor translator" delimiter="; ">
        <name sort-separator=", " initialize-with=". " name-as-sort-order="all" delimiter=", " delimiter-precedes-last="always"/>
        <label form="short" prefix=", " text-case="title"/>
      </names>
      <names variable="collection-editor">
        <name sort-separator=", " initialize-with=". " name-as-sort-order="all" delimiter=", " delimiter-precedes-last="always"/>
        <label form="short" prefix=", " text-case="title"/>
      </names>
    </group>
  </macro>
  <macro name="author">
    <names variable="author">
      <name sort-separator=", " initialize-with=". " name-as-sort-order="all" delimiter="; " delimiter-precedes-last="always"/>
      <label form="short" prefix=", " text-case="capitalize-first"/>
    </names>
  </macro>
  <macro name="publisher">
    <choose>
      <if type="thesis" match="any">
        <text variable="publisher"/>
      </if>
      <else>
        <group delimiter=": ">
          <text variable="publisher"/>
          <text variable="publisher-place"/>
        </group>
      </else>
    </choose>
  </macro>
  <macro name="title">
    <choose>
      <if type="bill book graphic legal_case legislation motion_picture report song" match="any">
        <text variable="title" text-case="title" font-style="italic"/>
      </if>
      <else>
        <text variable="title" text-case="title"/>
      </else>
    </choose>
  </macro>
  <macro name="volume">
    <group delimiter=" ">
      <label variable="volume" form="short" text-case="capitalize-first"/>
      <text variable="volume"/>
    </group>
  </macro>
  <macro name="series">
    <text variable="collection-title"/>
  </macro>
  <macro name="pages">
    <group delimiter=" ">
      <label variable="page" form="short" strip-periods="true"/>
      <text variable="page"/>
    </group>
  </macro>
  <macro name="book-container">
    <group delimiter=". ">
      <text macro="title"/>
      <choose>
        <if type="entry-dictionary entry-encyclopedia" match="none">
          <group delimiter=" ">
            <text term="in" text-case="capitalize-first"/>
            <text variable="container-title" font-style="italic"/>
          </group>
        </if>
        <else>
          <text variable="container-title" font-style="italic"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="issued">
    <date variable="issued" delimiter=" ">
      <date-part name="year"/>
    </date>
  </macro>
  <macro name="full-issued">
    <date variable="issued" delimiter=" ">
      <date-part name="month" form="long" suffix=" "/>
      <date-part name="day" suffix=", "/>
      <date-part name="year"/>
    </date>
  </macro>
  <macro name="edition">
    <choose>
      <if is-numeric="edition">
        <group delimiter=" ">
          <number variable="edition" form="ordinal"/>
          <text term="edition" form="short"/>
        </group>
      </if>
      <else>
        <text variable="edition" suffix="."/>
      </else>
    </choose>
  </macro>
  <macro name="access">
    <choose>
      <if variable="DOI" match="any">
        <text variable="DOI" prefix="https://doi.org/"/>
      </if>
      <else-if type="article-journal book chapter entry-encyclopedia entry-dictionary paper-conference" match="none">
        <choose>
          <if variable="URL">
            <group delimiter=" ">
              <text variable="URL"/>
              <group delimiter=" " prefix="(" suffix=")">
                <text term="accessed"/>
                <date variable="accessed">
                  <date-part name="year"/>
                  <date-part name="month" prefix="-" form="numeric-leading-zeros"/>
                  <date-part name="day" prefix="-" form="numeric-leading-zeros"/>
                </date>
              </group>
            </group>
          </if>
        </choose>
      </else-if>
    </choose>
  </macro>
  <citation collapse="citation-number">
    <sort>
      <key variable="citation-number"/>
    </sort>
    <layout delimiter="," vertical-align="sup">
      <text variable="citation-number"/>
    </layout>
  </citation>
  <bibliography second-field-align="flush" entry-spacing="0">
    <layout>
      <text variable="citation-number" prefix="(" suffix=")"/>
      <group delimiter=". " suffix=".">
        <text macro="author"/>
        <choose>
          <if type="article-journal review" match="any">
            <group delimiter=" ">
              <text macro="title" suffix="."/>
              <text variable="container-title" font-style="italic" form="short"/>
              <group delimiter=", ">
                <text macro="issued" font-weight="bold"/>
                <choose>
                  <if variable="volume">
                    <group delimiter=" ">
                      <text variable="volume" font-style="italic"/>
                      <text variable="issue" prefix="(" suffix=")"/>
                    </group>
                  </if>
                  <else>
                    <group delimiter=" ">
                      <text term="issue" form="short" text-case="capitalize-first"/>
                      <text variable="issue"/>
                    </group>
                  </else>
                </choose>
                <text variable="page"/>
              </group>
            </group>
          </if>
          <else-if type="article-magazine article-newspaper article" match="any">
            <group delimiter=" ">
              <text macro="title" suffix="."/>
              <text variable="container-title" font-style="italic" suffix="."/>
              <text macro="edition"/>
              <text macro="publisher"/>
              <group delimiter=", ">
                <text macro="full-issued"/>
                <text macro="pages"/>
              </group>
            </group>
          </else-if>
          <else-if type="thesis">
            <group delimiter=", ">
              <group delimiter=". ">
                <text macro="title"/>
                <text variable="genre"/>
              </group>
              <text macro="publisher"/>
              <text macro="issued"/>
              <text macro="volume"/>
              <text macro="pages"/>
            </group>
          </else-if>
          <else-if type="bill book graphic legal_case legislation motion_picture report song" match="any">
            <group delimiter="; ">
              <group delimiter=", ">
                <text macro="title"/>
                <text macro="edition"/>
              </group>
              <text macro="editor" prefix=" "/>
              <text macro="series"/>
              <choose>
                <if type="report">
                  <group delimiter=" ">
                    <text variable="genre"/>
                    <text variable="number"/>
                  </group>
                </if>
              </choose>
              <group delimiter=", ">
                <text macro="publisher"/>
                <text macro="issued"/>
              </group>
              <group delimiter=", ">
                <text macro="volume"/>
                <text macro="pages"/>
              </group>
            </group>
          </else-if>
          <else-if type="patent">
            <group delimiter=", ">
              <group delimiter=". ">
                <text macro="title"/>
                <text variable="number"/>
              </group>
              <date variable="issued" form="text"/>
            </group>
          </else-if>
          <else-if type="chapter paper-conference entry-dictionary entry-encyclopedia" match="any">
            <group delimiter="; ">
              <text macro="book-container"/>
              <text macro="editor"/>
              <text macro="series"/>
              <group delimiter=", ">
                <text macro="publisher"/>
                <text macro="issued"/>
              </group>
              <group delimiter=", ">
                <text macro="volume"/>
                <text macro="pages"/>
              </group>
            </group>
          </else-if>
          <else-if type="webpage post post-weblog" match="any">
            <group delimiter=". ">
              <text variable="title" font-style="italic"/>
              <text variable="container-title"/>
            </group>
          </else-if>
          <else>
            <group delimiter=", ">
              <group delimiter=". ">
                <text macro="title"/>
                <text variable="container-title" font-style="italic"/>
              </group>
              <group delimiter=", ">
                <text macro="issued"/>
                <text variable="volume" font-style="italic"/>
                <text variable="page"/>
              </group>
            </group>
          </else>
        </choose>
      </group>
      <text macro="access" prefix=" "/>
    </layout>
  </bibliography>
</style>
`;
