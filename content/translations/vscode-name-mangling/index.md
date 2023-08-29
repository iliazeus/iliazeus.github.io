---
title: Как уменьшали размер VS Code, используя name mangling
date: 2023-08-22
description: сокращение идентификаторов во время сборки

extra:
  lang: ru
  links:
    - rel: author
      text: by Matt Bierner
      href: https://code.visualstudio.com/blogs/2023/07/20/mangling-vscode
    - rel: alternate
      text: habr
      href: https://habr.com/ru/articles/756186/
---

Не так давно, мы уменьшили на 20% объем итогового скомпилированного JavaScript-кода в Visual Studio Code. В абсолютных числах это около 3.9 МБ. Хоть это и меньше типичной гифки из блога, цифра все равно значительная! Это положительно влияет не только на объем скачиваемых данных для очередного обновления, но и на время запуска: меньше кода значит меньше работы для парсера и интерпретатора. И ко всему прочему, мы добились этого без удаления кода или каких-либо рефакторингов. Вместо этого, мы работали над новым шагом сборки: name mangling, сокращение имен сущностей.

В этой статье рассказывается, как мы обнаружили возможность такой оптимизации, какие подходы рассматривали, и как в конце концов добились уменьшения размера на 20%. Возможно, будет не так много конкретики — я хочу, скорее, рассказать, как в команде VS Code подходят к решению инженерных задач. Тем более, что наше решение, скорее всего, не совсем оптимальное, и уж точно подойдет не всем кодовым базам.

## Диагностируем проблему

Команда VS Code всегда серьезно подходит к производительности. Мы оптимизируем горячий код, уменьшаем количество перерисовок UI и ускоряем запуск программы. Кроме всего прочего, это означает, что мы всегда пытаемся по возможности уменьшить размер приложения. Еще более насущной проблема размера стала с выходом web-версии VS Code (https://vscode.dev). По этим причинам, мы следим за изменениями размера скомпилированного кода от релиза к релизу.

К сожалению, чаще всего размер растет. Несмотря на то, что мы стараемся не перегружать VS Code фичами, отдавая часть на откуп расширениям, их число все равно увеличивается, а с ними приходит и новый код. Например, `workbench.js`, один из наших главных скомпилированных файлов, за восемь лет вырос в четыре раза. Конечно, это объясняется тем, что тогда у VS Code, еще не было многих привычных сейчас фич — вкладок, к примеру, или встроенного терминала. Но увеличение размера кода все равно нас беспокоило.

<figure class="border">

![Размер workbench.js, главного файла VS Code, по версиям](graph.png)

<figcaption>Размер workbench.js, главного файла VS Code, по версиям</figcaption>

</figure>

Размер приложения мог бы вырасти намного больше, чем в четыре раза — если бы мы все это время не искали способы с этим бороться. Все очевидные оптимизации мы уже применяем; в их числе минификация с помощью [esbuild]. А находить новые с годами становится все сложнее. Многие из оптимизаций просто слишком рискованны, или требуют слишком много человеко-часов для внедрения и поддержки. Поэтому годы шли, а размер билда рос.

[esbuild]: https://esbuild.github.io/

Пока однажды, в прошлом году, я не заметил неожиданную вещь. Наш минифицированный JavaScript-код все равно содержал кучу длинных идентификаторов вроде `extensionIgnoredRecommendationsService`. Неожиданно это было потому, что `esbuild` должен был уметь превращать их в более короткие!

Этот процесс в среде JavaScript-тулинга называют name mangling — термин [заимствован] из мира компилируемых языков, но используется немного в другом значении. Как часть минификации JavaScript, name mangling превращает длинные имена в короткие. Например, такой код:

[заимствован]: https://en.wikipedia.org/wiki/Name_mangling

```typescript
const someLongVariableName = 123;
console.log(someLongVariableName);
```

Превращается в такой:

```typescript
const x = 123;
console.log(x);
```

С точки зрения языков, которые компилируются в машинный код, такое преобразование выглядит глупо. Но так как приложения на TypeScript и JavaScript распространяются в виде JS-кода, длина имен играет далеко не последнюю роль в размере билда.

Разумеется, нет смысла бросать все и идти переименовывать все переменные в коде. Даже самые большие оптимизации размера билда не должны идти в ущерб читаемости и поддерживаемости кода — а код, где все имена однобуквенные, сложно назвать читаемым! Другое дело — менять имена автоматически, во время сборки приложения. Как это и должен делать `esbuild`.

Правда, алгоритм, который он использует, очень консервативен. Он меняет имена, только если точно уверен, что это ничего не сломает; грубо говоря, он меняет только имена локальных переменных и аргументов функций. Такое умолчание вполне разумно — дебажить код, сломанный во время минификации, это то еще развлечение. Но, с другой стороны, это значит, что многие идентификаторы `esbuild` пропускает, хотя мог бы их сократить.

Как пример того, как name mangling может все сломать, рассмотрим такой код:

```typescript
const obj = { longPropertyName: 123 };

function lookup(prop) {
  return obj[prop];
}

console.log(lookup("longPropertyName"));
```

Минификатор мог бы заменить `longPropertyName` на просто `x`. Но тогда бы сломался доступ к полю по ключу-переменной:

```typescript
const obj = { x: 123 }; // Здесь минификатор заменил `longPropertyName`

function lookup(prop) {
  return obj[prop];
}

console.log(lookup("longPropertyName")); // А здесь — нет, и все сломалось
```

Пример, понятное дело, искусственный. Но подобное действительно может произойти в продакшн-коде. Сломаться могут:

- доступ к полю по переменной;
- сериализация и парсинг JSON;
- API, которые предоставляет ваш код — клиент ожидает конкретные имена;
- API, которые используете вы — к примеру, DOM.

Несомненно, `esbuild` можно заставить сократить вообще все идентификаторы. Но сразу сломается все из списка выше — и для VS Code это фатально.

Но я все равно считал, что можно было бы справиться лучше. Если нельзя поменять _каждое_ имя, то, может быть, можно хотя бы поменять еще какое-то их подмножество?

## Первая попытка: сокращаем приватные поля

Я заметил еще одну вещь, когда смотрел на наш скомпилированный код: многие длинные имена начинались с `_`. В нашей кодовой базе так обозначаются приватные поля. Я подумал: ага! к ним никто не обращается извне соответствующих классов; наверняка их можно безболезненно переименовать, и никакой другой код это не затронет.

Меня останавливало только то, что, по какой-то причине, сам `esbuild` так не делал. Наверняка на это есть какая-то причина, подумал я. И действительно — это бы сломало доступ к полю по ключу-переменной, как в примере выше. Конечно, _хороший_ TypeScript-программист вряд ли стал бы так обращаться к приватным полям, но в реальном мире такой код все-таки встречается.

Стоит, кроме того, понимать, что ключевое слово `private` в TypeScript, на самом деле, не такое уж строгое. Компиляция в JavaScript, фактически, просто стирает это ключевое слово, превращая приватные поля в обычные. Это означает, что ничего не мешает _невоспитанному_ программисту залезть прямо в кишочки класса:

```typescript
class Foo {
  private bar = 123;
}

const foo: any = new Foo();
console.log(foo.bar);
```

Ваш код _(я надеюсь)_ вряд ли делает что-нибудь подобное, но переименование приватных полей может аукнуться тысячей чрезвычайно веселых способов: при использовании `{ ...spread }`, при сериализации, а также при неудачном совпадении имен приватных полей нескольких классов.

Применительно конкретно к VS Code, однако, у меня было большое преимущество: наш код адекватного (по большей части) качества. Я вполне мог рассчитывать, что к приватным полям никогда не обращаются по ключу-переменной или через `any`. Поэтому я мог действовать смелее, чем `esbuild`.

Итак, я и [Йоханнес Рикен] стали искать инструменты для сокращения имен приватных полей. Нашей первой идеей было заменить все приватные поля "в стиле TypeScript" (`private foo`) на ["настоящие" приватные поля] из JavaScript (`#foo`). Они лишены всех описанных выше проблем, поэтому `esbuild` с радостью их переименовывает. Кроме того, логично было отказаться от TS-специфичной фичи в пользу доступной в чистом JS.

[Йоханнес Рикен]: https://twitter.com/johannesrieken
["настоящие" приватные поля]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields

К сожалению, мы довольно быстро поняли, что так просто ничего не получится. В код придется внести большое количество изменений; кроме всего прочего, придется убрать все использования [parameter properties], даже там, где они делают код намного читаемее. Кроме того, приватные поля — довольно новая для JavaScript фича, и не везде она уже хорошо оптимизирована. В некоторых ситуациях, код с приватными полями может быть [медленнее на 95%]! В будущем, возможно, использование приватных полей JS было бы для нас правильным решением — но не сейчас.

[parameter properties]: https://www.typescriptlang.org/docs/handbook/2/classes.html#parameter-properties
[медленнее на 95%]: https://bugs.webkit.org/show_bug.cgi?id=258660

Далее, мы обратили внимание на то, что `esbuild` можно заставить сокращать имена у тех полей, которые матчатся заданным регулярным выражением. Это условие касается только самих имен — не включая квалификаторы вроде `private` — но мы рассчитывали, что все наши `private` и `protected`-поля начинаются с символа `_`. Довольно быстро мы написали конфиг `esbuild`, который бы сокращал все такие имена.

И довольно быстро выяснили, что все не так просто. Во-первых, к сожалению, все еще не везде в нашей кодовой базе приватные поля начинают с подчеркивания. Во-вторых, иногда с подчеркивания начинаются _публичные_ поля — как правило, там, где поле должно быть доступно извне, но не должно быть частью API; например, в тестах.

Мы не были уверены, что после такого преобразования наш код останется корректным. В этом, конечно, можно было бы убедиться путем тщательного тестирования, но свеч это не стоит, да и стопроцентного покрытия добиться чрезвычайно трудно.

## Сокращаем приватные поля с помощью TypeScript

Нашей новой идеей было следующее: что, если бы мы смогли заставить TypeScript проверить, что поля были переименованы корректно? Компилятор ведь умеет отлавливать обращения к необъявленным переменным. Мы решили сокращать имена в процессе сборки _до_ вызова компилятора TypeScript, чтобы он ругнулся на забытое где-то старое имя, которое теперь нигде не объявлено.

Кроме того, если у нас в распоряжении исходный TypeScript-код, мы можем вытащить из него и сократить имена только тех полей, которые действительно являются `private`, без необходимости проставлять подчеркивание в каждое имя. Мы даже можем не писать руками код самого переименования — в TypeScript уже есть поддержка подобных рефакторингов.

Вот псевдокод получившегося у нас алгоритма сокращения имен приватных полей:

```
используя TypeScript AST, получаем все private и protected поля в кодовой базе
для каждого такого поля:
    если поле подлежит сокращению:
        придумать новое уникальное имя
        сгенерировать TypeScript-рефакторинг, переименовывающий поле

применить все сгенерированные рефакторинги

отдать TypeScript на компиляцию полученный исходник
```

Это очень наивный алгоритм, но он, по большей части, работает! Но для нашей кодовой базы нам пришлось обработать еще несколько крайних случаев:

- Новое имя для поля должно быть уникальным не только в пределах текущего класса, но и в пределах всех его предков и потомков. Причина, опять-таки, в том, что ключевое слово `private` в TypeScript существует только на этапе компиляции, и ничего не мешает классам в рантайме залезть в приватные поля своих предков или потомков. К счастью, TypeScript выдает ошибку компиляции, если видит коллизию полей класса и его потомка.

- В нескольких местах нашей кодовой базы, классы-потомки делали унаследованное приватное поле публичным. Во многих местах это было сделано по ошибке, но мы все-таки добавили в наш алгоритм отдельную проверку такого случая.

После того, как мы добавили обработку этих крайних случаев, мы стали получать рабочие билды. Проверив наш скрипт на `workbench.js`, основном файле VS Code, мы обнаружили, что его размер уменьшился с 12.3 МБ до 10.6 МБ — почти на 14%. Это очень даже неплохо, если учесть, что нам почти не пришлось менять сам код!

## Дальнейшие исследования

Наш эксперимент с сокращением приватных имен показал, что в кодовой базе и системе сборки VS Code все еще остался потенциал для значительных оптимизаций, которые не требовали бы больших затрат и изменений кода. Не думаю, что я был первым, кто заметил длинные имена в скомпилированном коде VS Code; однако сократить их так, чтобы ничего не сломать было, как мы выяснили, не совсем тривиально.

Когда мы взялись за эту задачу, мы прежде всего определили конкретное подмножество имен, которые можно безопасно сократить — имена приватных полей. Затем мы нашли максимально безопасный способ это сделать. Для этого нам понадобился TypeScript — с его помощью мы ищем и переименовываем переменные, и он же потом собирает код и ругается на ошибки. Очень помогло нам и то, что в нашей кодовой базе мы пытаемся следовать лучшим практикам TypeScript, а также держим весь основной код покрытым тестами. Все это позволило нам с Йоханнесом, фактически, в свободное время разработать инструмент, который помог оптимизировать размер билда, при этом никак не мешая работе над кодом.

Конечно, простор для сокращения имен еще остался. В результирующем коде, к моему сожалению, я все еще видел длинные имена вроде `provideWorkspaceTrustExtensionProposals`, или — из самого заметного — почти 5 тысяч упоминаний функции `localize`.

Пользуясь описанным выше подходом, я вскорости нашел еще одно подмножество имен, которые можно безопасно сократить: экспортируемые имена, если они не являются частью публичного API. Я был уверен, что их тоже можно сравнительно легко сократить.

И, по большей части, это было так. Хотя пришлось, конечно, опять обрабатывать крайние случаи. К примеру, нам совсем не нужно было трогать API для расширений VS Code. Мы также не могли ничего делать с теми именами, которые используются из чистого JS — в основном, это точки входа процессов и воркеров.

Сокращение имен экспортов уменьшило размер `workbench.js` еще сильнее — с 10.6 МБ до 9.8 МБ. В итоге, этот файл стал на 20% меньше, чем был, когда мы только начинали. По всей кодовой базе сокращение имен помогло сэкономить 3.9 МБ размера итогового JavaScript-кода. Это означало не только меньший размер на диске, но и меньшее время старта приложения.

Ниже я еще раз приведу график изменения размера `workbench.js` по версиям. Два резких падения в правой части графика — это эффект от сокращения имен: имена приватных полей были сокращены в VS Code 1.74, имена экспортов — в VS Code 1.80.

<figure class="border">

![Размер workbench.js, главного файла VS Code, по версиям](graph.png)

<figcaption>Размер workbench.js, главного файла VS Code, по версиям</figcaption>

</figure>

Безусловно, наша реализация сокращения имен далека от идеала, и еще много длинных имен остается после сборки. Вероятно, мы еще вернемся к этой теме, если поймем, что дальнейшие оптимизации дадут нам серьезный выхлоп, и если будет способ сделать их, не сломав код. В будущем, нам даже, возможно, не потребуется что-то самим для этого писать — сборщики с каждым годом становятся все умнее, и все лучше понимают, какие имена можно безопасно менять. Нашу реализацию сокращения имен можно увидеть [по ссылке].

[по ссылке]: https://github.com/microsoft/vscode/blob/48cd8e0c1b142a46f0956b593d8331145634658e/build/lib/mangle/index.ts

Надеюсь, этим примером я смог показать, что нам важна оптимизация, и как мы к ней подходим. Оптимизация, в нашем понимании — это бесконечный процесс. Мы используем мониторинг размера билда (и других показателей), чтобы найти потенциал для очередного улучшения. Мы стараемся применять лучшие практики TypeScript, чтобы не бояться автоматизированных рефакторингов. Мы пишем инструменты, которые позволяют нам быть уверенными, что изменения не будут огромными и не сломают код.

Я горжусь результатом, и горжусь тем, как мы его достигли.